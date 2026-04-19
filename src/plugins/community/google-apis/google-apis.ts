/**
 * @file google-apis.ts
 *
 * Google APIs broker plugin for A.L.I.C.E. Assistant.
 *
 * This is a pure infrastructure plugin that handles OAuth2 authentication
 * lifecycle and offers authenticated Google API clients (Gmail, Calendar,
 * People) to downstream consumer plugins. It registers zero LLM tools of its own.
 *
 * Follows the `brave-search-api` pattern: broker infrastructure with
 * capability-offer architecture.
 */

import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import * as path from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import { AccountStore, type GoogleAccount } from './account-store.js';
import { OAuthManager } from './oauth-manager.js';

// ---------------------------------------------------------------------------
// Plugin config schema
// ---------------------------------------------------------------------------

const GoogleApisPluginConfigSchema = Type.Object({
  /** Default OAuth client ID (can be overridden per-account). */
  clientId: Type.Optional(
    Type.String({
      description:
        'Google OAuth client ID. Can also be set per-account via the web UI.',
    })
  ),
  /** Default OAuth client secret (can be overridden per-account). */
  clientSecret: Type.Optional(
    Type.String({
      description:
        'Google OAuth client secret. Can also be set per-account via the web UI.',
    })
  ),
  /** Port for the OAuth redirect URI. Defaults to 47153 (the default web-ui port). */
  redirectPort: Type.Optional(
    Type.Number({
      description: 'Port number for the OAuth redirect URI.',
      default: 47153,
    })
  ),
});

type GoogleApisPluginConfig = Type.Static<typeof GoogleApisPluginConfigSchema>;

// ---------------------------------------------------------------------------
// Plugin capabilities type augmentation
// ---------------------------------------------------------------------------

export type GoogleApisCapability = {
  getAuthenticatedClient: (accountId: string) => Promise<OAuth2Client | null>;
  getGmailClient: (
    accountId: string
  ) => Promise<import('@googleapis/gmail').gmail_v1.Gmail | null>;
  getCalendarClient: (
    accountId: string
  ) => Promise<import('@googleapis/calendar').calendar_v3.Calendar | null>;
  getPeopleClient: (
    accountId: string
  ) => Promise<import('@googleapis/people').people_v1.People | null>;
  listAccounts: () => string[];
  getAccountInfo: (accountId: string) => GoogleAccount | null;
  initiateOAuthFlow: (accountId: string) => Promise<string>;
  disconnectAccount: (accountId: string) => Promise<void>;
};

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'google-apis': GoogleApisCapability;
  }
}

// ---------------------------------------------------------------------------
// REST API route handlers
// ---------------------------------------------------------------------------

type Logger = {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

function registerRestRoutes(
  app: import('express').Express,
  accountStore: AccountStore,
  oauthManager: OAuthManager,
  config: { getPluginConfig: () => GoogleApisPluginConfig },
  logger: Logger
): void {
  // GET /api/google-apis/accounts — list all configured accounts and their status
  app.get('/api/google-apis/accounts', async (_req, res) => {
    try {
      const accountIds = accountStore.listAccountIds();
      const accounts = accountIds.map(id => {
        const account = accountStore.getAccount(id);
        return {
          accountId: id,
          email: account?.email ?? null,
          displayName: account?.displayName ?? null,
          isAuthenticated: account?.isAuthenticated ?? false,
          lastRefreshedAt: account?.lastRefreshedAt ?? null,
        };
      });
      res.json({ accounts });
    } catch (err) {
      logger.error(
        `GET /api/google-apis/accounts: ${err instanceof Error ? err.message : String(err)}`
      );
      res.status(500).json({
        error: `Failed to list accounts: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // POST /api/google-apis/accounts — initiate OAuth flow for a new account
  app.post('/api/google-apis/accounts', async (req, res) => {
    try {
      const { accountId } = req.body as { accountId?: string };
      if (
        !accountId ||
        typeof accountId !== 'string' ||
        accountId.trim() === ''
      ) {
        res
          .status(400)
          .json({ error: 'Missing or invalid "accountId" field.' });
        return;
      }

      // Validate accountId format: only alphanumeric, hyphens, underscores
      if (!/^[a-zA-Z0-9_-]+$/.test(accountId)) {
        res.status(400).json({
          error:
            'Account ID can only contain letters, numbers, hyphens, and underscores.',
        });
        return;
      }

      const consentUrl = await oauthManager.initiateFlow(accountId.trim());
      res.json({ consentUrl, accountId: accountId.trim() });
    } catch (err) {
      logger.error(
        `POST /api/google-apis/accounts: ${err instanceof Error ? err.message : String(err)}`
      );
      res.status(500).json({
        error: `Failed to initiate OAuth flow: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // DELETE /api/google-apis/accounts/:accountId — disconnect an account
  app.delete('/api/google-apis/accounts/:accountId', async (req, res) => {
    try {
      const { accountId } = req.params;
      const account = accountStore.getAccount(accountId);
      if (!account) {
        res.status(404).json({ error: `Account "${accountId}" not found.` });
        return;
      }

      await oauthManager.disconnectAccount(accountId);
      res.json({ success: true, accountId });
    } catch (err) {
      logger.error(
        `DELETE /api/google-apis/accounts/:accountId: ${err instanceof Error ? err.message : String(err)}`
      );
      res.status(500).json({
        error: `Failed to disconnect account: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // GET /api/google-apis/accounts/:accountId/status — detailed status for one account
  app.get('/api/google-apis/accounts/:accountId/status', async (req, res) => {
    try {
      const { accountId } = req.params;
      const account = accountStore.getAccount(accountId);
      if (!account) {
        res.status(404).json({ error: `Account "${accountId}" not found.` });
        return;
      }

      res.json({
        accountId: account.accountId,
        email: account.email ?? null,
        displayName: account.displayName ?? null,
        isAuthenticated: account.isAuthenticated,
        lastRefreshedAt: account.lastRefreshedAt ?? null,
      });
    } catch (err) {
      logger.error(
        `GET /api/google-apis/accounts/:accountId/status: ${err instanceof Error ? err.message : String(err)}`
      );
      res.status(500).json({
        error: `Failed to get account status: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // GET /api/google-apis/oauth/callback — OAuth2 redirect URI handler
  app.get('/api/google-apis/oauth/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      if (error) {
        // User denied access or Google returned an error
        logger.warn(`OAuth callback received error: ${error}`);
        res.redirect(
          `/google-apis?error=${encodeURIComponent(error as string)}`
        );
        return;
      }

      if (!code || !state) {
        res.status(400).json({
          error: 'Missing code or state parameter in OAuth callback.',
        });
        return;
      }

      const result = await oauthManager.handleCallback(state, code);

      // Redirect back to the web UI with a success message
      res.redirect(
        `/google-apis?connected=${encodeURIComponent(result.accountId)}&email=${encodeURIComponent(result.email)}`
      );
    } catch (err) {
      logger.error(
        `GET /api/google-apis/oauth/callback: ${err instanceof Error ? err.message : String(err)}`
      );
      res.redirect(
        `/google-apis?error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`
      );
    }
  });

  // GET /api/google-apis/config — get current client ID (non-secret) + redirect URI
  app.get('/api/google-apis/config', async (_req, res) => {
    try {
      const pluginConfig = config.getPluginConfig();
      // Check vault first (where the web UI stores them), then static config
      const vaultDefaults =
        await accountStore.loadClientCredentials('_default');
      const hasDefaultCredentials = !!(
        vaultDefaults ??
        (pluginConfig.clientId && pluginConfig.clientSecret)
      );
      const activeClientId = vaultDefaults?.clientId ?? pluginConfig.clientId;
      res.json({
        hasDefaultCredentials,
        clientIdPreview: activeClientId
          ? `${activeClientId.slice(0, 8)}...`
          : null,
        redirectUri: `http://127.0.0.1:${pluginConfig.redirectPort ?? 47153}/api/google-apis/oauth/callback`,
      });
    } catch (err) {
      logger.error(
        `GET /api/google-apis/config: ${err instanceof Error ? err.message : String(err)}`
      );
      res.status(500).json({
        error: `Failed to get config: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // POST /api/google-apis/config — store OAuth client credentials as default
  app.post('/api/google-apis/config', async (req, res) => {
    try {
      const { clientId, clientSecret } = req.body as {
        clientId?: string;
        clientSecret?: string;
      };

      if (!clientId || typeof clientId !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "clientId" field.' });
        return;
      }
      if (!clientSecret || typeof clientSecret !== 'string') {
        res
          .status(400)
          .json({ error: 'Missing or invalid "clientSecret" field.' });
        return;
      }

      // Store as per-account credentials for a special "_default" account
      // that serves as the fallback when no per-account credentials are set.
      await accountStore.saveClientCredentials(
        '_default',
        clientId,
        clientSecret
      );

      res.json({
        success: true,
        message:
          'OAuth client credentials saved. They will be used as the default for accounts that do not have their own credentials.',
      });
    } catch (err) {
      logger.error(
        `POST /api/google-apis/config: ${err instanceof Error ? err.message : String(err)}`
      );
      res.status(500).json({
        error: `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const googleApisPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'google-apis',
    name: 'Google APIs Plugin',
    brandColor: '#4285f4', // Google Blue
    description:
      'Provides authenticated Google API clients (Gmail, Calendar, People) ' +
      'for other plugins to use. Handles OAuth2 authentication with multi-account ' +
      'support and persists tokens in the credential vault.',
    version: 'LATEST',
    dependencies: [
      { id: 'credential-store', version: 'LATEST' },
      { id: 'web-ui', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config<GoogleApisPluginConfig>(
      GoogleApisPluginConfigSchema,
      {}
    );

    plugin.logger.log('registerPlugin: Initializing Google APIs plugin...');

    // Request dependencies
    const credentialStore = plugin.request('credential-store');

    // Instantiate the account store and OAuth manager
    const accountStore = new AccountStore(credentialStore);
    const oauthManager = new OAuthManager(
      accountStore,
      {
        clientId: config.getPluginConfig().clientId,
        clientSecret: config.getPluginConfig().clientSecret,
        redirectPort: config.getPluginConfig().redirectPort ?? 47153,
      },
      plugin.logger
    );

    // Migrate config credentials to vault if they're not already stored
    if (
      config.getPluginConfig().clientId &&
      config.getPluginConfig().clientSecret
    ) {
      try {
        const existingDefaults =
          await accountStore.loadClientCredentials('_default');
        if (!existingDefaults) {
          await accountStore.saveClientCredentials(
            '_default',
            config.getPluginConfig().clientId!,
            config.getPluginConfig().clientSecret!
          );
          plugin.logger.warn(
            'registerPlugin: Migrated OAuth client credentials from plugin config to the credential vault. ' +
              'You can remove clientId/clientSecret from the plugin settings file.'
          );
        }
      } catch {
        // Best effort migration
      }
    }

    // Offer capabilities to downstream plugins
    plugin.offer<'google-apis'>({
      getAuthenticatedClient: (accountId: string) => {
        return oauthManager.getClient(accountId);
      },
      getGmailClient: (accountId: string) => {
        return oauthManager.getGmailClient(accountId);
      },
      getCalendarClient: (accountId: string) => {
        return oauthManager.getCalendarClient(accountId);
      },
      getPeopleClient: (accountId: string) => {
        return oauthManager.getPeopleClient(accountId);
      },
      listAccounts: () => {
        const ids = accountStore.listAccountIds();

        return ids;
      },
      getAccountInfo: (accountId: string) => {
        const info = accountStore.getAccount(accountId) ?? null;

        return info;
      },
      initiateOAuthFlow: (accountId: string) =>
        oauthManager.initiateFlow(accountId),
      disconnectAccount: (accountId: string) =>
        oauthManager.disconnectAccount(accountId),
    });

    // Lifecycle hooks
    plugin.hooks.onAssistantWillAcceptRequests(async () => {
      plugin.logger.log(
        'onAssistantWillAcceptRequests: Restoring Google accounts from vault...'
      );

      try {
        await accountStore.restoreFromVault();
        const accountIds = accountStore.listAccountIds();
        const authenticatedCount = accountIds.filter(
          id => accountStore.getAccount(id)?.isAuthenticated
        ).length;

        plugin.logger.log(
          `onAssistantWillAcceptRequests: Restored ${accountIds.length} Google account(s), ${authenticatedCount} authenticated.`
        );

        // Try to refresh expired tokens for all authenticated accounts
        for (const accountId of accountIds) {
          if (accountStore.getAccount(accountId)?.isAuthenticated) {
            try {
              await oauthManager.refreshIfExpired(accountId);
            } catch (err) {
              plugin.logger.error(
                `onAssistantWillAcceptRequests: refreshIfExpired FAILED for ${accountId}: ${err instanceof Error ? err.message : String(err)}`
              );
              // Best effort — the auto-refresh listener will handle it
            }
          }
        }
        plugin.logger.log('onAssistantWillAcceptRequests: DONE');
      } catch (err) {
        plugin.logger.error(
          `onAssistantWillAcceptRequests: Failed to restore accounts from vault: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      const webUi = plugin.request('web-ui');
      const app = webUi.express;

      registerRestRoutes(
        app,
        accountStore,
        oauthManager,
        config,
        plugin.logger
      );

      // Register the web UI script and stylesheet
      const currentDir = import.meta.dirname;
      webUi.registerScript(path.join(currentDir, 'google-apis-web-ui.js'));
      webUi.registerStylesheet(path.join(currentDir, 'google-apis-web-ui.css'));

      plugin.logger.log(
        'onAssistantAcceptsRequests: Google APIs REST routes and web UI registered.'
      );
    });

    plugin.logger.log('registerPlugin: Google APIs plugin registered.');
  },
};

export default googleApisPlugin;
