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
      // This API is intentionally minimal for now, and will likely expand in the future. 
      // For now, it just allows plugins to offer reminder data in a standardized format, and to register callback functions that the assistant can call when it wants to create or manage reminders.
      registerReminderSourceProvider: (name: string, getRemindersCallback: () => Promise<Reminder[]>) => void;
      registerReminderNotificationProvider: (name: string, notificationCallback: (reminder: Reminder) => void) => void;
    }
  }
}

const remindersBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'reminders-broker',
    name: 'Reminders Broker Plugin',
    description: 'Provides an API for other plugins to create, manage, and receive reminders. This plugin does not implement any reminder storage or notification mechanism itself, but rather serves as a central hub for reminder-related functionality that other plugins can utilize.',
    version: 'LATEST',
    dependencies: [
      { id: 'datetime', version: 'LATEST' },
    ],
    required: true,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(remindersBrokerPlugin.pluginMetadata);

    plugin.offer<'reminders-broker'>({
      registerReminderSourceProvider: (name, getRemindersCallback) => {
        // Store the callback and call it whenever we want to get reminders from this source.
      },
      registerReminderNotificationProvider: (name, notificationCallback) => {
        // Store the callback and call it whenever we want to notify this source about a reminder.
      },
    });
  }
};

export default remindersBrokerPlugin;
