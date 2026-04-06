import { AlicePlugin } from '../../lib.js';

const notificationsConversationPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-conversation',
    name: 'Notifications Conversation Plugin',
    description: 'A notifications provider for the notifications-broker system plugin. Adds any ' +
      'active notifications to the system prompts for the assistant to work into conversation ' +
      'naturally. Also gives the assistant a tool for marking notifications delivered when it ' +
      'thinks it has done so in conversation.',
    version: 'LATEST',
    dependencies: [{ id: 'notifications-broker', version: 'LATEST' }],
    required: false,
    system: true,
  },
  
  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
  }
};

export default notificationsConversationPlugin;
