import { AlicePlugin } from '../../lib/types/alice-plugin-interface.js';

const appointmentsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'appointments',
    name: 'Appointments Plugin',
    description: 'Provides the assistant with an internal storage for appointments, and ' +
      'tools to manage it. Use this if you don\'t want to use a third-party calendar ' +
      'service or share data with a desktop application.',
    version: 'LATEST',
    dependencies: [
      { id: 'reminders-broker', version: 'LATEST' },
      { id: 'datetime', version: 'LATEST' },
      { id: 'memory', version: 'LATEST' },
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(appointmentsPlugin.pluginMetadata);
  }
};

export default appointmentsPlugin;
