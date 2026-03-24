import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const remindersNotificationConversationPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'reminders-notification-conversation',
    name: 'Reminders Notification Conversation Plugin',
    description: 'A notifications provider for the reminders-broker system plugin. Adds any ' +
      'upcoming reminders to the system prompts for the assistant to work into conversation naturally.',
    version: 'LATEST',
    dependencies: [{ id: 'reminders-broker', version: 'LATEST' }],
    required: false,
    system: true,
  },
  
  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(remindersNotificationConversationPlugin.pluginMetadata);
  }
};

export default remindersNotificationConversationPlugin;
