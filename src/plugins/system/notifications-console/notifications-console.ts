import { AlicePlugin } from '../../../lib.js';

const notificationsConsolePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-console',
    name: 'Notifications Console Plugin',
    description: 'A fallback notification sink that logs notifications to the console so ' +
      'the assistant has a default delivery path even when no richer notification sinks are enabled.',
    version: 'LATEST',
    dependencies: [
      { id: 'notifications-broker', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { registerNotificationSink } = plugin.request('notifications-broker')!;

    await registerNotificationSink('notifications-console', {
      sendNotification: async (notification) => {
        console.log('ALICE Notification');
        console.log(`  Title: ${notification.title}`);
        console.log(`  Source: ${notification.source}`);
        console.log(`  Message: ${notification.message}`);
      },
    });
  }
};

export default notificationsConsolePlugin;