import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const appointmentsPlugin: AlicePlugin = {
  pluginMetadata: {
    name: 'Appointments Plugin',
    description: 'Provides the assistant with an internal storage for appointments, and ' +
      'tools to manage it. Use this if you don\'t want to use a third-party calendar ' +
      'service or share data with a desktop application.',
    version: 'LATEST',
    dependencies: [
      { name: 'reminders-broker', version: 'LATEST' },
      { name: 'datetime', version: 'LATEST' },
      { name: 'memory', version: 'LATEST' },
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(appointmentsPlugin.pluginMetadata);
  }
};

export default appointmentsPlugin;
