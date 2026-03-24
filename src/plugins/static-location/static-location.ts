import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const StaticLocationPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'static-location',
    name: 'Static Location Plugin',
    description: 'A location provider plugin for location-broker that provides a static ' +
      'location to the assistant from the user\'s configuration settings. This is useful for ' +
      'testing, and desktop PCs that don\'t really move',
    version: 'LATEST',
    dependencies: [{ id: 'location-broker', version: 'LATEST' }],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(StaticLocationPlugin.pluginMetadata);
  }
}

export default StaticLocationPlugin;
