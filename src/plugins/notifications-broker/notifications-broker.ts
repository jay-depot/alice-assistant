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

      /**
       * Registers a new notification sink that will receive all notifications dispatched 
       * by this plugin.
       */
      registerNotificationSink: (name: string, sink: { sendNotification: (notification: { title: string; message: string; source: string }) => Promise<void> }) => Promise<void>;
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

    const notificationSinks: Record<string, (notification: { title: string; message: string; source: string }) => Promise<void>> = {};

    plugin.offer<'notifications-broker'>({
      sendNotification: async (notification) => {
        // Here you would typically forward the notification to any registered notification 
        // sinks for delivery to the user. For now, we're going to "deliver" the notification 
        // by logging it on the console.
        // TBH, in the future, notifications-console should probably be a real thing, if 
        // nothing else as a last resort option if every other one is broken.

        await Promise.all(Object.keys(notificationSinks).map(async (name) => {
          const send = notificationSinks[name];
          if (process.env.ALICE_DEBUG) {
            console.log('Notifications Broker: Forwarding notification to sink:', name, JSON.stringify(notification, null, 2));
          }
          await send(notification);
        }));
      },
      registerNotificationSink: async (name, sink) => {
        // Here you would typically add the sink to a list of registered sinks
        // so that all future notifications are forwarded to it.
        
        notificationSinks[name] = sink.sendNotification;

        console.log('Notifications Broker: Registered new notification sink:', name);
      }
    });
  }
};

export default notificationsBrokerPlugin;
