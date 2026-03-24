import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const newsBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    name: 'News Broker Plugin',
    description: 'Provides an API for other plugins to offer news data to the assistant, and for other plugins to request news data from any plugin that has it.',
    version: 'LATEST',
    dependencies: [
      { name: 'location-broker', version: 'LATEST' },
      { name: 'datetime', version: 'LATEST' },
    ],
    required: false,
    system: true,
  },
  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(newsBrokerPlugin.pluginMetadata);
  }
};

export default newsBrokerPlugin;
