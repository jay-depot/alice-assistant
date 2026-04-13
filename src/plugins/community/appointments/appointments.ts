import { AlicePlugin } from '../../../lib.js';

const appointmentsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'appointments',
    name: 'Appointments Plugin',
    brandColor: '#2417b5',
    description:
      'Provides the assistant with an internal storage for appointments, and ' +
      "tools to manage it. Use this if you don't want to use a third-party calendar " +
      'service or share data with a desktop application.',
    version: 'LATEST',
    dependencies: [
      { id: 'reminders-broker', version: 'LATEST' },
      { id: 'datetime', version: 'LATEST' },
      { id: 'memory', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const plugin = await pluginInterface.registerPlugin();
  },
};

export default appointmentsPlugin;
