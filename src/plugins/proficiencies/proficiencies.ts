import { AlicePlugin } from '../../lib.js';

const proficienciesPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'proficiencies',
    name: 'Proficiencies Plugin',
    description: 'Proficiencies are skills the assistant can create and maintain for itself. ' +
      'They are primarily a way for the assistant to maintain organized banks of knowledge ' +
      'about specific, important, frequently referenced topics or tasks. Includes built in ' +
      'limits for the total number of proficiencies may have, and manages LFU removal of old ' +
      'proficiencies when the limit is exceeded.',
    version: 'LATEST',
    dependencies: [
      { id: 'memory', version: 'LATEST' },
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
  }
};

export default proficienciesPlugin;
