/**
 * @file email-types.ts
 *
 * Shared email type definitions for the email-broker plugin and its providers.
 *
 * These types define the contract between the email-broker (which owns the
 * LLM tools) and provider plugins (like gmail) that implement the actual
 * email operations.
 */

/** Standardized email message shape passed between broker and providers. */
export type EmailMessage = {
  id: string;
  threadId?: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Plain text body */
  body: string;
  /** HTML body (optional, providers best-effort) */
  bodyHtml?: string;
  /** ISO 8601 date string */
  date: string;
  /** Gmail-style labels, e.g. ['INBOX', 'UNREAD', 'IMPORTANT'] */
  labels?: string[];
  hasAttachments: boolean;
  attachmentNames?: string[];
};

/** Result shape for email operations (send, etc.). */
export type EmailActionResult = {
  /** Provider name that handled the operation */
  provider: string;
  success: boolean;
  /** Human-readable result */
  message: string;
  /** ID of the created/modified message */
  messageId?: string;
};

/** Parameters for searching emails. */
export type EmailSearchParams = {
  /** Search query (provider-specific syntax allowed) */
  query: string;
  /** Maximum number of results to return. Default: 10 */
  maxResults?: number;
  includeSpamTrash?: boolean;
};

/** Parameters for reading a specific email. */
export type EmailReadParams = {
  messageId: string;
  /** Default: 'full' */
  format?: 'full' | 'metadata' | 'minimal';
};

/** Parameters for sending an email. */
export type EmailSendParams = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** If set, sends as a reply in the thread */
  replyToMessageId?: string;
  /** If set, sends via the specified provider. Otherwise, uses the first registered provider. */
  provider?: string;
};

/**
 * The interface that email provider plugins implement.
 *
 * Each provider must provide all three methods. The broker dispatches
 * read operations (search, read) to ALL providers in parallel, but
 * write operations (send) to a specific provider.
 */
export type EmailProvider = {
  searchEmails: (params: EmailSearchParams) => Promise<EmailMessage[]>;
  readEmail: (params: EmailReadParams) => Promise<EmailMessage | null>;
  sendEmail: (params: EmailSendParams) => Promise<EmailActionResult>;
};
