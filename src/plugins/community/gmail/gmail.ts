/**
 * @file gmail.ts
 *
 * Gmail provider plugin for A.L.I.C.E. Assistant.
 *
 * Community plugin that bridges the Google Gmail API into the email-broker.
 * For each authenticated Google account, it registers a separate email provider
 * named `gmail:{accountId}` with the email-broker.
 *
 * Dependencies: google-apis (for OAuth clients), email-broker (for provider registration).
 */

import Type, { Static } from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import type { GoogleApisCapability } from '../google-apis/google-apis.js';
import type {
  EmailMessage,
  EmailActionResult,
  EmailSearchParams,
  EmailReadParams,
  EmailSendParams,
  EmailProvider,
} from '../../system/email-broker/email-types.js';

// ---------------------------------------------------------------------------
// Plugin config schema
// ---------------------------------------------------------------------------

const GmailPluginConfigSchema = Type.Object({
  /** Preferred Google account ID. If empty, uses the first available account. */
  preferredAccount: Type.Optional(
    Type.String({
      description:
        'The Google account ID to prefer for email operations. If empty, the first available account is used.',
    })
  ),
  /** Maximum number of results per search. Default: 10 */
  maxResultsPerSearch: Type.Optional(
    Type.Number({
      description: 'Maximum number of results per search query. Default: 10.',
      default: 10,
    })
  ),
  /** Default account to use for sending email. If empty, uses preferredAccount or first available. */
  defaultSendAccount: Type.Optional(
    Type.String({
      description:
        'The Google account ID to use for sending email. If empty, uses preferredAccount or the first available account.',
    })
  ),
});

type GmailPluginConfig = Static<typeof GmailPluginConfigSchema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GmailClient = any; // gmail_v1.Gmail from @googleapis/gmail

// ---------------------------------------------------------------------------
// Gmail utility functions
// ---------------------------------------------------------------------------

/**
 * Extract a header value from Gmail message headers.
 * Gmail headers are returned as an array of { name, value } objects.
 */
function getHeaderValue(
  headers: Array<{ name?: string; value?: string }>,
  headerName: string
): string | undefined {
  const header = headers.find(
    h => h.name?.toLowerCase() === headerName.toLowerCase()
  );
  return header?.value;
}

/**
 * Extract all values for a header from Gmail message headers.
 */
function getHeaderValues(
  headers: Array<{ name?: string; value?: string }>,
  headerName: string
): string[] {
  return headers
    .filter(h => h.name?.toLowerCase() === headerName.toLowerCase())
    .map(h => h.value ?? '')
    .filter(v => v !== '');
}

/**
 * Decode a base64url-encoded string (as used by Gmail API).
 */
function decodeBase64Url(encoded: string): string {
  // Gmail uses base64url encoding (replaces + with - and / with _)
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  // Pad with = if necessary
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf-8');
}

/**
 * Extract the text/plain body from a Gmail message payload.
 * Walks the payload parts recursively to find the text/plain part.
 */
function extractTextBody(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any
): string {
  if (!payload) return '';

  // If the payload has a body with data and mimeType is text/plain
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // If the payload has parts, recurse
  if (payload.parts && Array.isArray(payload.parts)) {
    // First look for text/plain specifically
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }

    // Then recurse into multipart parts
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }

  // Fallback: if the top-level body has data, decode it
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return '';
}

/**
 * Extract the text/html body from a Gmail message payload.
 */
function extractHtmlBody(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any
): string | undefined {
  if (!payload) return undefined;

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }

    // Recurse into multipart parts
    for (const part of payload.parts) {
      const html = extractHtmlBody(part);
      if (html) return html;
    }
  }

  return undefined;
}

/**
 * Build a simple MIME message for sending via the Gmail API.
 * Gmail requires raw MIME messages to be base64url-encoded.
 */
function buildMimeMessage(params: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  from?: string;
  replyToMessageId?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];

  // From header
  if (params.from) {
    lines.push(`From: ${params.from}`);
  }

  // To header
  lines.push(`To: ${params.to.join(', ')}`);

  // Cc header
  if (params.cc && params.cc.length > 0) {
    lines.push(`Cc: ${params.cc.join(', ')}`);
  }

  // Subject
  lines.push(
    `Subject: =?UTF-8?B?${Buffer.from(params.subject).toString('base64')}?=`
  );

  // Reply headers (for threading)
  if (params.inReplyTo) {
    lines.push(`In-Reply-To: ${params.inReplyTo}`);
  }
  if (params.references) {
    lines.push(`References: ${params.references}`);
  }

  // Content type
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('MIME-Version: 1.0');

  // Blank line between headers and body
  lines.push('');
  lines.push(params.body);

  const mimeMessage = lines.join('\r\n');
  return Buffer.from(mimeMessage).toString('base64url');
}

/**
 * Convert a Gmail API message to our standardized EmailMessage format.
 */
function gmailMessageToEmailMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any
): EmailMessage {
  const headers = message.payload?.headers ?? [];
  const labelIds: string[] = message.labelIds ?? [];

  return {
    id: message.id ?? '',
    threadId: message.threadId ?? undefined,
    from: getHeaderValue(headers, 'From') ?? '(unknown sender)',
    to: getHeaderValues(headers, 'To'),
    cc:
      getHeaderValues(headers, 'Cc').length > 0
        ? getHeaderValues(headers, 'Cc')
        : undefined,
    bcc:
      getHeaderValues(headers, 'Bcc').length > 0
        ? getHeaderValues(headers, 'Bcc')
        : undefined,
    subject: getHeaderValue(headers, 'Subject') ?? '(No subject)',
    body: extractTextBody(message.payload),
    bodyHtml: extractHtmlBody(message.payload),
    date: getHeaderValue(headers, 'Date') ?? '',
    labels: labelIds.length > 0 ? labelIds : undefined,
    hasAttachments:
      message.payload?.parts?.some(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (part: any) => part.filename && part.filename.length > 0
      ) ?? false,
    attachmentNames:
      message.payload?.parts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.filter((part: any) => part.filename && part.filename.length > 0)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((part: any) => part.filename) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const gmailPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'gmail',
    name: 'Gmail Plugin',
    brandColor: '#EA4335', // Gmail Red
    description:
      'Provides Gmail email functionality through the email-broker plugin. ' +
      'Requires the google-apis plugin with an authenticated Google account.',
    version: 'LATEST',
    dependencies: [
      { id: 'google-apis', version: 'LATEST' },
      { id: 'email-broker', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    // Load plugin config (creates the config file if it doesn't exist)
    await plugin.config<GmailPluginConfig>(GmailPluginConfigSchema, {
      maxResultsPerSearch: 10,
    });

    // Request capabilities from dependencies
    const googleApis = plugin.request('google-apis') as
      | GoogleApisCapability
      | undefined;
    const emailBroker = plugin.request('email-broker');

    if (!googleApis) {
      plugin.logger.error(
        'registerPlugin: google-apis capability not available. ' +
          'Ensure the google-apis plugin is enabled and loaded before gmail.'
      );
      return;
    }

    if (!emailBroker) {
      plugin.logger.error(
        'registerPlugin: email-broker capability not available. ' +
          'Ensure the email-broker plugin is enabled and loaded before gmail.'
      );
      return;
    }

    // Register providers after all plugins have loaded
    plugin.hooks.onAllPluginsLoaded(async () => {
      plugin.logger.log(
        'onAllPluginsLoaded: Registering Gmail email providers.'
      );

      const accountIds = googleApis.listAccounts();

      if (accountIds.length === 0) {
        plugin.logger.warn(
          'onAllPluginsLoaded: No Google accounts are connected. ' +
            'The gmail plugin requires at least one authenticated Google account. ' +
            'Please connect a Google account via the google-apis web UI.'
        );
        return;
      }

      for (const accountId of accountIds) {
        const accountInfo = googleApis.getAccountInfo(accountId);
        if (!accountInfo?.isAuthenticated) {
          plugin.logger.warn(
            `onAllPluginsLoaded: Google account "${accountId}" is not authenticated. Skipping.`
          );
          continue;
        }

        const providerName = `gmail:${accountId}`;

        const provider: EmailProvider = {
          searchEmails: async (params: EmailSearchParams) =>
            searchEmails(googleApis, accountId, params, plugin.logger),

          readEmail: async (params: EmailReadParams) =>
            readEmail(googleApis, accountId, params, plugin.logger),

          sendEmail: async (params: EmailSendParams) =>
            sendEmail(googleApis, accountId, params, plugin.logger),
        };

        emailBroker.registerEmailProvider(providerName, provider);
        plugin.logger.log(
          `onAllPluginsLoaded: Registered email provider "${providerName}".`
        );
      }
    });
  },
};

// ---------------------------------------------------------------------------
// Gmail API operations
// ---------------------------------------------------------------------------

async function searchEmails(
  googleApis: GoogleApisCapability,
  accountId: string,
  params: EmailSearchParams,
  logger: { error: (...args: unknown[]) => void }
): Promise<EmailMessage[]> {
  try {
    const gmailClient = (await googleApis.getGmailClient(
      accountId
    )) as GmailClient | null;
    if (!gmailClient) {
      logger.error(
        `searchEmails: Could not get Gmail client for account "${accountId}".`
      );
      return [];
    }

    const listParams: Record<string, unknown> = {
      userId: 'me',
      q: params.query,
      maxResults: params.maxResults ?? 10,
    };

    if (params.includeSpamTrash) {
      listParams.includeSpamTrash = true;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listResponse: any = await gmailClient.users.messages.list(listParams);

    const messages = listResponse.data?.messages ?? [];
    if (messages.length === 0) {
      return [];
    }

    // Fetch each message's details
    const emailMessages: EmailMessage[] = [];
    for (const msg of messages) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messageDetail: any = await gmailClient.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
        });
        emailMessages.push(gmailMessageToEmailMessage(messageDetail.data));
      } catch (err) {
        logger.error(
          `searchEmails: Failed to fetch message ${msg.id}: ${err instanceof Error ? err.message : String(err)}`
        );
        // Continue with other messages — graceful degradation
      }
    }

    return emailMessages;
  } catch (err) {
    logger.error(
      `searchEmails: Gmail search failed for account "${accountId}": ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

async function readEmail(
  googleApis: GoogleApisCapability,
  accountId: string,
  params: EmailReadParams,
  logger: { error: (...args: unknown[]) => void }
): Promise<EmailMessage | null> {
  try {
    const gmailClient = (await googleApis.getGmailClient(
      accountId
    )) as GmailClient | null;
    if (!gmailClient) {
      logger.error(
        `readEmail: Could not get Gmail client for account "${accountId}".`
      );
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await gmailClient.users.messages.get({
      userId: 'me',
      id: params.messageId,
      format: params.format ?? 'full',
    });

    if (!response.data) {
      return null;
    }

    return gmailMessageToEmailMessage(response.data);
  } catch (err) {
    logger.error(
      `readEmail: Failed to read message ${params.messageId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

async function sendEmail(
  googleApis: GoogleApisCapability,
  accountId: string,
  params: EmailSendParams,
  logger: { error: (...args: unknown[]) => void }
): Promise<EmailActionResult> {
  try {
    const gmailClient = (await googleApis.getGmailClient(
      accountId
    )) as GmailClient | null;
    if (!gmailClient) {
      return {
        provider: `gmail:${accountId}`,
        success: false,
        message: `Could not get Gmail client for account "${accountId}".`,
      };
    }

    // Determine reply headers if this is a reply
    let inReplyTo: string | undefined;
    let references: string | undefined;
    let threadId: string | undefined;

    if (params.replyToMessageId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const originalMessage: any = await gmailClient.users.messages.get({
          userId: 'me',
          id: params.replyToMessageId,
          format: 'metadata',
          metadataHeaders: ['Message-ID', 'References'],
        });

        const origHeaders = originalMessage.data?.payload?.headers ?? [];
        const messageIdHeader = getHeaderValue(origHeaders, 'Message-ID');
        const referencesHeader = getHeaderValue(origHeaders, 'References');

        if (messageIdHeader) {
          inReplyTo = messageIdHeader;
          references = referencesHeader
            ? `${referencesHeader} ${messageIdHeader}`
            : messageIdHeader;
        }

        threadId = originalMessage.data?.threadId;
      } catch (err) {
        logger.error(
          `sendEmail: Failed to fetch original message for reply: ${err instanceof Error ? err.message : String(err)}`
        );
        // Continue without reply headers — best effort
      }
    }

    // Build the MIME message
    const rawMime = buildMimeMessage({
      to: params.to,
      cc: params.cc,
      subject: params.subject,
      body: params.body,
      inReplyTo,
      references,
    });

    // Send the email
    const sendParams: Record<string, unknown> = {
      userId: 'me',
      requestBody: {
        raw: rawMime,
      },
    };

    // If this is a reply, associate it with the thread
    if (threadId) {
      sendParams.requestBody = {
        ...((sendParams.requestBody as Record<string, unknown>) ?? {}),
        threadId,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sendResponse: any = await gmailClient.users.messages.send(sendParams);

    return {
      provider: `gmail:${accountId}`,
      success: true,
      message: 'Email sent successfully.',
      messageId: sendResponse.data?.id ?? undefined,
    };
  } catch (err) {
    return {
      provider: `gmail:${accountId}`,
      success: false,
      message: `Failed to send email: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export default gmailPlugin;
