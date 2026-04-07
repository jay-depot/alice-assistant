import { AlicePlugin } from '../../lib.js';

const notificationsChatInterruptionPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-chat-interruption',
    name: 'Notifications Chat Interruption Plugin',
    description: 'A plugin that inserts active notifications into the middle of the ' +
      'assistant\'s most recently active chat session as they are received. This *should* ' +
      'cause the assistant to proactively mention these reminders right away.',
    version: 'LATEST',
    dependencies: [{ id: 'notifications-broker', version: 'LATEST' }],
    required: false,
    system: true,
  },
  
  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
  }
};

export default notificationsChatInterruptionPlugin;
