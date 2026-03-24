import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

type NewsItem = {
  headline: string;
  preview: string;
  url: string;
  source: string;
  publishedAt: Date;
};

declare module '../../lib/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'news-broker': {
      // This API is intentionally minimal for now, and will likely expand in the future. 
      // For now, it just allows plugins to offer news data in a standardized format, and to request news data from any plugin that offers it.
      registerNewsProvider: (name: string, callback: (query: string) => Promise<NewsItem[]>) => void;
      requestNewsData: (query: string) => Promise<NewsItem[] | undefined>; // returns undefined if no plugin offers news data, otherwise returns the most recently offered news data.
    }
  }
};

const newsBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'news-broker',
    name: 'News Broker Plugin',
    description: 'Provides an API for other plugins to offer news data to the assistant, and for other plugins to request news data from any plugin that has it.',
    version: 'LATEST',
    dependencies: [
      { id: 'location-broker', version: 'LATEST' },
      { id: 'datetime', version: 'LATEST' },
    ],
    required: false,
    system: true,
  },
  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(newsBrokerPlugin.pluginMetadata);

    plugin.offer<'news-broker'>({
      registerNewsProvider: (name, callback) => {
        // Store the callback and call it whenever we want to get news from this provider.
      },
      requestNewsData: (query) => {
        // Call the most recently registered news provider's callback with the query and return the result,
        // or return undefined if no provider is registered.
        return undefined;
      },
    });
  }
};

export default newsBrokerPlugin;
