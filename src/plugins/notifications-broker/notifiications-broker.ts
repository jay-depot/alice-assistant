import { AlicePlugin } from '../../lib.js';

declare module '../../lib.js' {
  export interface PluginCapabilities {
    'notifications-broker': {
      /**
       * Dispatches a notification to the user's preferred notification sink. Guaranteed 
       * not to resolve the promise until the notification is at least durably written 
       * into a queue for delivery, if not delivered, so shutdown is safe if all 
       * outstanding calls to this are resolved.
       */
      sendNotification: (notification: { title: string; message: string; source: string }) => Promise<void>;
    }
  }
}

const notificationsBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-broker',
    name: 'Notifications Broker Plugin',
    description: 'Provides an API for other plugins to send notifications to the user. This plugin ' +
      'serves as a central hub for all notifications from any plugins that wish to send them, and ' +
      'forwards them to any registered notification sinks for delivery to the user.',
    version: 'LATEST',
    dependencies: [],
    required: true,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.offer<'notifications-broker'>({
      sendNotification: async (notification) => {
        // Here you would typically forward the notification to any registered notification 
        // sinks for delivery to the user. For now, we're going to "deliver" the notification 
        // by logging it on the console.
        // TBH, in the future, notifications-console should probably be a real thing, if 
        // nothing else as a last resort option if every other one is broken.
        console.log('New notification:', notification);
      }
    });
  }
};

export default notificationsBrokerPlugin;
