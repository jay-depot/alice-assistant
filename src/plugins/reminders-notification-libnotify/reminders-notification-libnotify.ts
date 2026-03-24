import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const remindersNotificationLibnotifyPlugin: AlicePlugin = {
  pluginMetadata: {
    name: 'Reminders Notification Libnotify Plugin',
    description: 'A reminders-broker notification provider plugin that uses libnotify ' +
      'to send notifications directly to the user without needing the LLM at all.',
    version: 'LATEST',
    dependencies: [
      { name: 'reminders-broker', version: 'LATEST' },
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(remindersNotificationLibnotifyPlugin.pluginMetadata);
    // Don't get distracted with implementing this until the plugin conversion is done.
    // But this is planned to be one of the better features of this thing, so it's happening soon.
  }
};

export default remindersNotificationLibnotifyPlugin;
