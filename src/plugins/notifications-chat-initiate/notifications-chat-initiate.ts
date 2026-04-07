import { AlicePlugin } from '../../lib.js';

const notificationsConversationInitiatePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-chat-initiate',
    name: 'Notifications Chat Initiate Plugin',
    description: 'A plugin that initiates a chat session with the assistant when new notifications ' +
      'are received. It is similar to the notifications-chat-segue plugin but instead of just adding ' +
      'notifications to the system prompt, it actively starts a chat session with the assistant to ' +
      'inform it of the new notification and allow it to deliver them immediately. You probably don\'t ' +
      'want both this and notifications-chat-segue enabled simultaneously. It will *work* but you ' +
      'will be annoyed.',
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
