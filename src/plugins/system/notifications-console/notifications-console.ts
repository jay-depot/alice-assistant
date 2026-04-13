import { AlicePlugin } from '../../../lib.js';

const notificationsConsolePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-console',
    name: 'Notifications Console Plugin',
    brandColor: '#a92503',
    description:
      'A fallback notification sink that logs notifications to the console so ' +
      'the assistant has a default delivery path even when no richer notification sinks are enabled.',
    version: 'LATEST',
    dependencies: [{ id: 'notifications-broker', version: 'LATEST' }],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { registerNotificationSink } = plugin.request(
      'notifications-broker'
    )!;

    await registerNotificationSink('notifications-console', {
      sendNotification: async notification => {
        plugin.logger.log('ALICE Notification');
        plugin.logger.log(`  Title: ${notification.title}`);
        plugin.logger.log(`  Source: ${notification.source}`);
        plugin.logger.log(`  Message: ${notification.message}`);
      },
    });
  },
};

export default notificationsConsolePlugin;
