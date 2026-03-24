import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const weatherBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    name: 'Weather Broker Plugin',
    description: 'Provides an API for other plugins to offer weather data to the assistant, ' +
      'and for other plugins to request weather data from any plugin that has it.',
      // TODO: Should we allow multiple weather providers to be registered at once?
    version: 'LATEST',
    dependencies: [
      { name: 'location-broker', version: 'LATEST' },
      { name: 'datetime', version: 'LATEST' },
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(weatherBrokerPlugin.pluginMetadata);
  }
};

export default weatherBrokerPlugin;
