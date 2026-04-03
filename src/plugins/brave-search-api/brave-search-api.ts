import Type from 'typebox';
import { AlicePlugin } from '../../lib.js';
import { BraveSearch } from 'brave-search';

const WebSearchBrokerPluginConfigSchema = Type.Object({
  apiKey: Type.Optional(Type.String({ description: 'API key for the Brave Search API' })),
});

type WebSearchBrokerPluginConfigSchema = Type.Static<typeof WebSearchBrokerPluginConfigSchema>;

declare module '../../lib.js' {
  export interface PluginCapabilities {
    'brave-search-api': {
      getBraveSearchApiClient: () => BraveSearch | null;
    }
  }
}

const braveSearchApiPlugin: AlicePlugin = {
  pluginMetadata: {
    description: 'Provides a common instance of the Brave search API client for other plugins to use.',
    id: 'brave-search-api',
    name: 'Brave Search API Plugin',
    required: false,
    system: true,
    version: 'LATEST',
    dependencies: [],
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config<WebSearchBrokerPluginConfigSchema>(WebSearchBrokerPluginConfigSchema, {});

    const apiKey = config.getPluginConfig().apiKey;

    plugin.offer<'brave-search-api'>({
      getBraveSearchApiClient: () => {
        if (!apiKey) {
          console.warn('Brave Search API Plugin: No API key provided, Brave Search API client will not work. Please provide an API key in the plugin configuration to enable Brave Search API functionality.');
          return null;
        }

        return new BraveSearch(apiKey);
      }
    });
  }
}

export default braveSearchApiPlugin;
