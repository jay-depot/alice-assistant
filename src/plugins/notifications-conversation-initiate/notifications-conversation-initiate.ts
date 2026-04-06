import { AlicePlugin } from '../../lib.js';

const notificationsConversationInitiatePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-conversation-initiate',
    name: 'Notifications Conversation Initiate Plugin',
    description: 'A plugin that initiates a conversation with the assistant when new notifications ' +
      'are received. It is similar to the notifications-conversation plugin but instead of just adding ' +
      'notifications to the system prompt, it actively starts a conversation with the assistant to ' +
      'inform it of the new notification and allow it to deliver them immediately. You should not ' +
      'have both this and notifications-conversation enabled simultaneously.',
    version: 'LATEST',
    dependencies: [{ id: 'notifications-broker', version: 'LATEST' }],
    required: false,
    system: true,
  },
  
  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
  }
};

export default notificationsConversationInitiatePlugin;
