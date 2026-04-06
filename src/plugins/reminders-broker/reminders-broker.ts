import { AlicePlugin } from '../../lib.js';

type Reminder = {
  id: string;
  title: string;
  description?: string;
  datetime: Date;
  source: string; // the name of the plugin that provided this reminder
};

declare module '../../lib.js' {
  export interface PluginCapabilities {
    'reminders-broker': {
      createNewReminder: (reminder: Omit<Reminder, 'id'>) => Promise<string>;
    }
  }
}

const remindersBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'reminders-broker',
    name: 'Reminders Broker Plugin',
    description: 'Provides an API for other plugins to create, manage, and receive reminders. This ' +
      'plugin does not implement any reminder storage or notification mechanism itself, but rather ' +
      'serves as a central repository for all reminders from any plugins that wish to create them.' +
      'As reminders come up in the schedule, they are forwarded to the notifications-broker plugin ' +
      'to be dispatched into all notification sinks for delivery to the user.',
    version: 'LATEST',
    dependencies: [
      { id: 'datetime', version: 'LATEST' },
      { id: 'memory', version: 'LATEST' },
      // { id: 'notifications-broker', version: 'LATEST' },
    ],
    required: true,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.offer<'reminders-broker'>({
      createNewReminder: async (reminder) => {
        // Generate a unique ID for the new reminder
        const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        // Store the reminder with the generated ID
        const newReminder = { ...reminder, id };
        // Here you would typically store the new reminder in a database or in-memory store
        // For now, we'll just log it
        console.log('New reminder created:', newReminder);
        return id;
      }
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      // Start up a 1 minute interval to check the database for any reminders that are due 
      // to be delivered, and if so, send them to notifications-broker to be sent to some 
      // notification sinks (hopefully) and then the user.
    });

    plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
      // Stop our loop so we don't end up losing notifications during shutdown. Then check 
      // for any pending loop resolution promises and resolve them, so we don't lose any 
      // reminders,
    });
  }
};

export default remindersBrokerPlugin;
