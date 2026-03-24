import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const remindersBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    name: 'Reminders Broker Plugin',
    description: 'Provides an API for other plugins to create, manage, and receive reminders. This plugin does not implement any reminder storage or notification mechanism itself, but rather serves as a central hub for reminder-related functionality that other plugins can utilize.',
    version: 'LATEST',
    dependencies: [
      { name: 'datetime', version: 'LATEST' },
    ],
    required: true,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(remindersBrokerPlugin.pluginMetadata);

    // plugin.offer({
    //   registerReminderSourceProvider: (name, getRemindersCallback: () => Reminder[]) => void,
    //   registerReminderNotificationProvider: (name, notificationCallback: (reminder: Reminder) => void) => void,
    // });
  }
};

export default remindersBrokerPlugin;
