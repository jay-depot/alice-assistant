import { Type } from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import { createMoltbookClient } from './moltbook-client.js';
import registerAgentTool from './tools/register-moltbook-agent.js';
import getClaimStatusTool from './tools/get-moltbook-claim-status.js';
import { getProfileTool, updateProfileTool } from './tools/profile-tools.js';
import {
  getCommentsTool,
  getFeedTool,
  getHomeTool,
  getPostTool,
  getSubmoltTool,
  listSubmoltsTool,
  searchTool,
} from './tools/read-tools.js';
import {
  createCommentTool,
  createPostTool,
  followTool,
  manageSubscriptionTool,
  submitVerificationTool,
  voteTool,
} from './tools/social-tools.js';

import {
  getNotificationsTool,
  markNotificationsReadTool,
} from './tools/notifications-tools.js';

import {
  requestDMTool,
  approveDMRequestTool,
  listDMConversationsTool,
  readDMConversationTool,
  sendDMMessageTool,
  listPendingDMRequestsTool,
  approvePendingDMRequestTool,
  scanForDMRequestIDsTool,
  checkDMStatusTool,
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

    plugin.registerTool(registerAgentTool(moltbookClient));
    plugin.registerTool(getClaimStatusTool(moltbookClient));
    plugin.registerTool(getProfileTool(moltbookClient));
    plugin.registerTool(updateProfileTool(moltbookClient));
    plugin.registerTool(getHomeTool(moltbookClient));
    plugin.registerTool(getNotificationsTool(moltbookClient));
    plugin.registerTool(getFeedTool(moltbookClient));
    plugin.registerTool(getPostTool(moltbookClient));
    plugin.registerTool(getCommentsTool(moltbookClient));
    plugin.registerTool(listSubmoltsTool(moltbookClient));
    plugin.registerTool(getSubmoltTool(moltbookClient));
    plugin.registerTool(searchTool(moltbookClient));
    plugin.registerTool(createPostTool(moltbookClient));
    plugin.registerTool(createCommentTool(moltbookClient));
    plugin.registerTool(submitVerificationTool(moltbookClient));
    plugin.registerTool(voteTool(moltbookClient));
    plugin.registerTool(followTool(moltbookClient));
    plugin.registerTool(manageSubscriptionTool(moltbookClient));
    plugin.registerTool(markNotificationsReadTool(moltbookClient));

    // DM tools
    plugin.registerTool(checkDMStatusTool(moltbookClient));
    plugin.registerTool(requestDMTool(moltbookClient));
    plugin.registerTool(approveDMRequestTool(moltbookClient));
    plugin.registerTool(listDMConversationsTool(moltbookClient));
    plugin.registerTool(readDMConversationTool(moltbookClient));
    plugin.registerTool(sendDMMessageTool(moltbookClient));
    plugin.registerTool(listPendingDMRequestsTool(moltbookClient));
    plugin.registerTool(approvePendingDMRequestTool(moltbookClient));
    plugin.registerTool(scanForDMRequestIDsTool(moltbookClient));

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
