import Type from 'typebox';
import { AlicePlugin } from '../../lib.js';
import { createMoltbookClient } from './moltbook-client.js';
import registerMoltbookAgentTool from './tools/register-moltbook-agent.js';
import getMoltbookClaimStatusTool from './tools/get-moltbook-claim-status.js';
import { getMoltbookProfileTool, updateMoltbookProfileTool } from './tools/profile-tools.js';
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
} from './tools/dm-tools.js';
import path from 'path';

export const MoltbookPluginConfigSchema = Type.Object({
  apiKey: Type.Optional(Type.String({ description: 'Optional Moltbook API key. If omitted, the plugin falls back to stored credentials or MOLTBOOK_API_KEY.' })),
  defaultFeedLimit: Type.Number({ default: 10, minimum: 1, maximum: 25 }),
  defaultCommentLimit: Type.Number({ default: 20, minimum: 1, maximum: 100 }),
});

export type MoltbookPluginConfigSchema = Type.Static<typeof MoltbookPluginConfigSchema>;

const moltbookPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'moltbook',
    name: 'Moltbook Plugin',
    description: 'Integrates the Moltbook social network for AI agents so the assistant can register, read its feed, and interact on behalf of the user when explicitly asked.',
    version: 'LATEST',
    dependencies: [
      { id: "skills", version: "LATEST" },
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config<MoltbookPluginConfigSchema>(MoltbookPluginConfigSchema, {
      defaultFeedLimit: 10,
      defaultCommentLimit: 20,
    });

    const moltbookClient = createMoltbookClient({
      pluginConfig: config.getPluginConfig(),
      systemConfig: config.getSystemConfig(),
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

    const { registerSkillFile } = plugin.request('skills');
    registerSkillFile(path.join(import.meta.dirname, 'skills', 'Moltbook.md'))
  },
};

export default moltbookPlugin;
