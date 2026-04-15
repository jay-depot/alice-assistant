/**
 * @file credential-store.ts
 *
 * Credential Store plugin for A.L.I.C.E. Assistant.
 *
 * Provides encrypted credential storage (vault) and secrets redaction.
 * The vault uses AES-256-GCM encryption with a key derived from a unique
 * Alice ID and a hardware identifier (machine-id on Linux, MAC address elsewhere).
 *
 * Other plugins can store and retrieve credentials via the offered API,
 * and can request a redactor instance to filter sensitive content.
 */

import { AlicePlugin } from '../../../lib.js';
import { Type, Static } from 'typebox';
import { Tool } from '../../../lib/tool-system.js';
import * as path from 'node:path';
import {
  initializeVault,
  storeSecret,
  retrieveSecret,
  deleteSecret,
  listSecretKeys,
  hasSecret,
  verifyVaultIntegrity,
  checkVaultPermissions,
} from './vault.js';
import { SecretsRedactor } from './redactor.js';

// ---------------------------------------------------------------------------
// Plugin config schema
// ---------------------------------------------------------------------------

const CredentialStorePluginConfigSchema = Type.Object({
  /** Whether to log warnings about plaintext credential files found during startup. */
  warnAboutPlaintextCredentials: Type.Boolean({ default: true }),
});

export type CredentialStorePluginConfig = Static<
  typeof CredentialStorePluginConfigSchema
>;

// ---------------------------------------------------------------------------
// LLM tool: manageCredentials
// ---------------------------------------------------------------------------

const manageCredentialsParameters = Type.Object({
  action: Type.Union([
    Type.Literal('list'),
    Type.Literal('store'),
    Type.Literal('delete'),
  ]),
  key: Type.Optional(
    Type.String({
      description:
        'The namespaced key for the credential (e.g., "moltbook.api_key"). Required for store and delete actions.',
    })
  ),
  value: Type.Optional(
    Type.String({
      description:
        'The secret value to store. Required for the store action. Never echoed back in results.',
    })
  ),
});

const manageCredentialsTool: Tool = {
  name: 'manageCredentials',
  availableFor: ['chat', 'autonomy'],
  description:
    'Manage credentials stored in the encrypted vault. Use "list" to see all stored credential keys, ' +
    '"store" to add or update a credential, and "delete" to remove one. Stored values are encrypted and ' +
    'never revealed — this tool will not echo back any secret values.',
  systemPromptFragment:
    'The manageCredentials tool allows you to store, list, and delete credentials in an encrypted vault. ' +
    'Credential values are never revealed in tool results. Use this tool when the user asks you to set up ' +
    'or manage API keys, tokens, or other secrets.',
  parameters: manageCredentialsParameters,
  toolResultPromptIntro: 'Result of managing credentials:\n',
  toolResultPromptOutro: '',
  taintStatus: 'secure',
  execute: async (args: Static<typeof manageCredentialsParameters>) => {
    const { action, key, value } = args;

    switch (action) {
      case 'list': {
        const keys = listSecretKeys();
        if (keys.length === 0) {
          return 'No credentials are currently stored in the vault.';
        }
        return `Stored credential keys:\n${keys.map(k => `  - ${k}`).join('\n')}`;
      }

      case 'store': {
        if (!key) {
          return 'Error: A key name is required for the store action.';
        }
        if (!value) {
          return 'Error: A value is required for the store action.';
        }
        try {
          storeSecret(key, value);
          return `Credential "${key}" has been stored in the vault. The value is encrypted and will not be revealed.`;
        } catch (err) {
          return `Error storing credential "${key}": ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      case 'delete': {
        if (!key) {
          return 'Error: A key name is required for the delete action.';
        }
        const deleted = deleteSecret(key);
        if (deleted) {
          return `Credential "${key}" has been deleted from the vault.`;
        }
        return `Credential "${key}" was not found in the vault.`;
      }

      default:
        return `Unknown action: ${action}`;
    }
  },
};

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'credential-store': {
      /** Store a secret in the encrypted vault. */
      storeSecret(key: string, plaintext: string): Promise<void>;
      /** Retrieve a secret from the vault. Returns undefined if the key doesn't exist. */
      retrieveSecret(key: string): Promise<string | undefined>;
      /** Delete a secret from the vault. Returns true if the key existed. */
      deleteSecret(key: string): Promise<boolean>;
      /** List all secret key names in the vault (without values). */
      listSecretKeys(): Promise<string[]>;
      /** Check whether a secret key exists in the vault. */
      hasSecret(key: string): Promise<boolean>;
      /** Get a SecretsRedactor instance for filtering content. */
      getRedactor(): Promise<SecretsRedactor>;
    };
  }
}

const credentialStorePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'credential-store',
    name: 'Credential Store',
    brandColor: '#e74c3c',
    description:
      'Provides encrypted credential storage and secrets redaction for A.L.I.C.E. Assistant. ' +
      'Other plugins can store and retrieve credentials via the offered API, and request a ' +
      'redactor instance to filter sensitive content before it reaches the LLM.',
    version: 'LATEST',
    dependencies: [{ id: 'web-ui', version: 'LATEST' }],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config(CredentialStorePluginConfigSchema, {
      warnAboutPlaintextCredentials: true,
    });

    plugin.logger.log('registerPlugin: Initializing credential vault...');

    // Initialize the vault file if it doesn't exist
    try {
      initializeVault();
      plugin.logger.log('registerPlugin: Vault initialized successfully.');
    } catch (err) {
      plugin.logger.error(
        `registerPlugin: Failed to initialize vault: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Create and refresh the redactor
    const redactor = new SecretsRedactor();

    // Register the LLM tool
    plugin.registerTool(manageCredentialsTool);

    // Offer the API to other plugins
    plugin.offer<'credential-store'>({
      storeSecret: async (key: string, plaintext: string) => {
        storeSecret(key, plaintext);
        // Refresh the redactor after storing a new secret
        await redactor.refreshFromVault();
      },
      retrieveSecret: async (key: string) => {
        return retrieveSecret(key);
      },
      deleteSecret: async (key: string) => {
        const result = deleteSecret(key);
        // Refresh the redactor after deleting a secret
        await redactor.refreshFromVault();
        return result;
      },
      listSecretKeys: async () => {
        return listSecretKeys();
      },
      hasSecret: async (key: string) => {
        return hasSecret(key);
      },
      getRedactor: async () => {
        if (!redactor.isVaultLoaded) {
          await redactor.refreshFromVault();
        }
        return redactor;
      },
    });

    // Lifecycle hooks
    plugin.hooks.onAssistantWillAcceptRequests(async () => {
      plugin.logger.log(
        'onAssistantWillAcceptRequests: Checking vault integrity...'
      );

      // Check vault integrity
      const integrity = verifyVaultIntegrity();
      if (integrity.vaultExists && !integrity.vaultReadable) {
        plugin.logger.error(
          `onAssistantWillAcceptRequests: VAULT INTEGRITY CHECK FAILED. ${integrity.error || 'The vault exists but cannot be decrypted. This usually means the hardware identifier has changed (e.g., NIC replacement or OS reinstall).'}`
        );
      } else if (integrity.vaultExists && integrity.keyCount > 0) {
        plugin.logger.log(
          `onAssistantWillAcceptRequests: Vault integrity OK. ${integrity.keyCount} credential(s) stored.`
        );
      }

      // Check vault file permissions
      const permCheck = checkVaultPermissions();
      if (!permCheck.ok && permCheck.mode) {
        plugin.logger.warn(
          `onAssistantWillAcceptRequests: Vault file permissions are too permissive (${permCheck.mode}). ` +
            `Consider running: chmod 600 ${permCheck.path}`
        );
      }

      // Refresh the redactor
      try {
        await redactor.refreshFromVault();
        plugin.logger.log(
          `onAssistantWillAcceptRequests: Redactor loaded with ${redactor.exactSecretCount} exact-match secret(s).`
        );
      } catch (err) {
        plugin.logger.error(
          `onAssistantWillAcceptRequests: Failed to refresh redactor: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      // Warn about plaintext credential files
      if (config.getPluginConfig().warnAboutPlaintextCredentials) {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { UserConfig } = await import('../../../lib/user-config.js');

        const configDir = UserConfig.getConfigPath();

        // Check for Moltbook credentials.json
        const moltbookCredPath = path.join(
          configDir,
          'plugin-settings',
          'moltbook',
          'credentials.json'
        );
        if (fs.existsSync(moltbookCredPath)) {
          plugin.logger.warn(
            'onAssistantWillAcceptRequests: Found plaintext credentials at ' +
              `${moltbookCredPath}. The Moltbook plugin should migrate these to the credential vault. ` +
              'Please remove this file after migration.'
          );
        }

        // Check for legacy web-search config with API key
        const webSearchConfigPath = path.join(
          configDir,
          'tool-settings',
          'webSearch',
          'web-search.json'
        );
        if (fs.existsSync(webSearchConfigPath)) {
          try {
            const content = JSON.parse(
              fs.readFileSync(webSearchConfigPath, 'utf-8')
            );
            if (
              content.braveSearchApiKey &&
              content.braveSearchApiKey !== 'PUT_YOUR_OWN_KEY_HERE'
            ) {
              plugin.logger.warn(
                'onAssistantWillAcceptRequests: Found plaintext API key in ' +
                  `${webSearchConfigPath}. Consider migrating it to the credential vault.`
              );
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    });

    // Register web UI API routes
    plugin.hooks.onAssistantAcceptsRequests(async () => {
      const webUi = plugin.request('web-ui');
      const app = webUi.express;

      // GET /api/credentials — list all vault key names (no values)
      app.get('/api/credentials', async (_req, res) => {
        try {
          const keys = listSecretKeys();
          res.json({ keys });
        } catch (err) {
          res.status(500).json({
            error: `Failed to list credentials: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      });

      // POST /api/credentials — store a secret
      app.post('/api/credentials', async (req, res) => {
        try {
          const { key, value } = req.body as { key?: string; value?: string };
          if (!key || typeof key !== 'string') {
            res.status(400).json({ error: 'Missing or invalid "key" field.' });
            return;
          }
          if (!value || typeof value !== 'string') {
            res
              .status(400)
              .json({ error: 'Missing or invalid "value" field.' });
            return;
          }
          storeSecret(key, value);
          await redactor.refreshFromVault();
          res.json({ success: true, key });
        } catch (err) {
          res.status(500).json({
            error: `Failed to store credential: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      });

      // DELETE /api/credentials/:key — delete a secret
      app.delete('/api/credentials/:key', async (req, res) => {
        try {
          const key = req.params.key;
          const deleted = deleteSecret(key);
          if (deleted) {
            await redactor.refreshFromVault();
          }
          res.json({ success: deleted, key });
        } catch (err) {
          res.status(500).json({
            error: `Failed to delete credential: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      });

      // GET /api/credentials/status — vault status
      app.get('/api/credentials/status', async (_req, res) => {
        try {
          const integrity = verifyVaultIntegrity();
          const permCheck = checkVaultPermissions();
          res.json({
            initialized: integrity.vaultExists,
            keyCount: integrity.keyCount,
            readable: integrity.vaultReadable,
            permissionsOk: permCheck.ok,
            permissionsMode: permCheck.mode,
            vaultPath: permCheck.path,
            error: integrity.error,
          });
        } catch (err) {
          res.status(500).json({
            error: `Failed to get vault status: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      });

      // Register the web UI script and stylesheet
      const currentDir = import.meta.dirname;
      webUi.registerScript(path.join(currentDir, 'credential-store-web-ui.js'));
      webUi.registerStylesheet(
        path.join(currentDir, 'credential-store-web-ui.css')
      );

      plugin.logger.log(
        'onAssistantAcceptsRequests: Credential Store API routes and web UI registered.'
      );
    });

    plugin.logger.log('registerPlugin: Credential Store plugin registered.');
  },
};

export default credentialStorePlugin;
