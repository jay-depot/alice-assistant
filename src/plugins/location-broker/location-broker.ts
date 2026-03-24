import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const locationBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    name: 'Location Broker Plugin',
    description: 'Provides an API for other plugins to offer location data to the assistant, ' +
      'and for other plugins to request location data from any plugin that offers it. Note: Only ' +
      'one location provider can be enabled at a time. This plugin will halt assistant startup ' +
      'with an error if two different plugins attempt to register as location providers at once.',
    version: 'LATEST',
    dependencies: [],
    required: true,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(locationBrokerPlugin.pluginMetadata);
  }
};

export default locationBrokerPlugin;
