import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import { createMoltbookClient } from './moltbook-client.js';
import registerMoltbookAgentTool from './tools/register-moltbook-agent.js';
import getMoltbookClaimStatusTool from './tools/get-moltbook-claim-status.js';
import {
  getMoltbookProfileTool,
  updateMoltbookProfileTool,
} from './tools/profile-tools.js';
import {
  getMoltbookCommentsTool,
  getMoltbookFeedTool,
  getMoltbookHomeTool,
  getMoltbookPostTool,
  getMoltbookSubmoltTool,
  listMoltbookSubmoltsTool,
  searchMoltbookTool,
} from './tools/read-tools.js';
import {
  createMoltbookCommentTool,
  createMoltbookPostTool,
  followMoltbookAgentTool,
  manageMoltbookSubscriptionTool,
  voteMoltbookContentTool,
} from './tools/social-tools.js';

import {
  getMoltbookNotificationsTool,
  markMoltbookNotificationsReadTool,
} from './tools/notifications-tools.js';

import {
  requestMoltbookDMTool,
  approveMoltbookDMRequestTool,
  listMoltbookDMConversationsTool,
  readMoltbookDMConversationTool,
  sendMoltbookDMMessageTool,
  listMoltbookPendingDMRequestsTool,
  approveMoltbookPendingDMRequestTool,
  scanForMoltbookDMRequestIDsTool,
} from './tools/dm-tools.js';
import path from 'path';

export const MoltbookPluginConfigSchema = Type.Object({
  apiKey: Type.Optional(
    Type.String({
      description:
        'Optional Moltbook API key. If omitted, the plugin falls back to stored credentials or MOLTBOOK_API_KEY.',
    })
  ),
  defaultFeedLimit: Type.Number({ default: 10, minimum: 1, maximum: 25 }),
  defaultCommentLimit: Type.Number({ default: 20, minimum: 1, maximum: 100 }),
});

export type MoltbookPluginConfigSchema = Type.Static<
  typeof MoltbookPluginConfigSchema
>;

const moltbookPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'moltbook',
    name: 'Moltbook Plugin',
    brandColor: '#a14627',
    description:
      'Integrates the Moltbook social network for AI agents so the assistant can register, ' +
      "read its feed, and interact on behalf of the user when explicitly asked. You REALLY shouldn't " +
      'enable this plugin. At all. But if you insist on trying to connect your assistant to Moltbook, ' +
      'this plugin tries to do it in the safest way possible. Consider it the least bad option.',
    version: 'LATEST',
    dependencies: [
      { id: 'skills', version: 'LATEST' },
      { id: 'credential-store', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config<MoltbookPluginConfigSchema>(
      MoltbookPluginConfigSchema,
      {
        defaultFeedLimit: 10,
        defaultCommentLimit: 20,
      }
    );

    const moltbookClient = createMoltbookClient({
      pluginConfig: config.getPluginConfig(),
      systemConfig: config.getSystemConfig(),
      credentialStore: plugin.request('credential-store'),
    });

    plugin.registerTool(registerMoltbookAgentTool(moltbookClient));
    plugin.registerTool(getMoltbookClaimStatusTool(moltbookClient));
    plugin.registerTool(getMoltbookProfileTool(moltbookClient));
    plugin.registerTool(updateMoltbookProfileTool(moltbookClient));
    plugin.registerTool(getMoltbookHomeTool(moltbookClient));
    plugin.registerTool(getMoltbookNotificationsTool(moltbookClient));
    plugin.registerTool(getMoltbookFeedTool(moltbookClient));
    plugin.registerTool(getMoltbookPostTool(moltbookClient));
    plugin.registerTool(getMoltbookCommentsTool(moltbookClient));
    plugin.registerTool(listMoltbookSubmoltsTool(moltbookClient));
    plugin.registerTool(getMoltbookSubmoltTool(moltbookClient));
    plugin.registerTool(searchMoltbookTool(moltbookClient));
    plugin.registerTool(createMoltbookPostTool(moltbookClient));
    plugin.registerTool(createMoltbookCommentTool(moltbookClient));
    plugin.registerTool(voteMoltbookContentTool(moltbookClient));
    plugin.registerTool(followMoltbookAgentTool(moltbookClient));
    plugin.registerTool(manageMoltbookSubscriptionTool(moltbookClient));
    plugin.registerTool(markMoltbookNotificationsReadTool(moltbookClient));

    // DM tools
    plugin.registerTool(requestMoltbookDMTool(moltbookClient));
    plugin.registerTool(approveMoltbookDMRequestTool(moltbookClient));
    plugin.registerTool(listMoltbookDMConversationsTool(moltbookClient));
    plugin.registerTool(readMoltbookDMConversationTool(moltbookClient));
    plugin.registerTool(sendMoltbookDMMessageTool(moltbookClient));
    plugin.registerTool(listMoltbookPendingDMRequestsTool(moltbookClient));
    plugin.registerTool(approveMoltbookPendingDMRequestTool(moltbookClient));
    plugin.registerTool(scanForMoltbookDMRequestIDsTool(moltbookClient));

    const { registerSkillFile } = plugin.request('skills');
    registerSkillFile(path.join(import.meta.dirname, 'skills', 'Moltbook.md'));

    // Migrate plaintext credentials to the vault on startup
    plugin.hooks.onAllPluginsLoaded(async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const credentialStore = plugin.request('credential-store');
      const credentialsFilePath = path.join(
        config.getSystemConfig().configDirectory,
        'plugin-settings',
        'moltbook',
        'credentials.json'
      );

      if (fs.existsSync(credentialsFilePath)) {
        try {
          const content = JSON.parse(
            fs.readFileSync(credentialsFilePath, 'utf-8')
          ) as Record<string, unknown>;
          let migrated = false;

          if (typeof content.api_key === 'string') {
            await credentialStore.storeSecret(
              'moltbook.api_key',
              content.api_key
            );
            migrated = true;
          }
          if (typeof content.agent_name === 'string') {
            await credentialStore.storeSecret(
              'moltbook.agent_name',
              content.agent_name
            );
          }
          if (typeof content.claim_url === 'string') {
            await credentialStore.storeSecret(
              'moltbook.claim_url',
              content.claim_url
            );
          }
          if (typeof content.verification_code === 'string') {
            await credentialStore.storeSecret(
              'moltbook.verification_code',
              content.verification_code
            );
          }

          if (migrated) {
            plugin.logger.warn(
              'onAllPluginsLoaded: Migrated plaintext credentials from ' +
                credentialsFilePath +
                ' to the credential vault. ' +
                'Please remove this file manually.'
            );
          }
        } catch (err) {
          plugin.logger.error(
            'onAllPluginsLoaded: Failed to migrate plaintext credentials: ' +
              (err instanceof Error ? err.message : String(err))
          );
        }
      }
    });
  },
};

export default moltbookPlugin;
