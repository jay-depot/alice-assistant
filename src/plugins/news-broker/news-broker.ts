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
      // returns an empty object if no plugin offers news data, otherwise checks all 
      // registered news providers for news data matching the query and returns the 
      // results in an object keyed by provider name.
      requestNewsData: (query: string) => Promise<Record<string, NewsItem[]>>; 
    }
  }
};

const newsBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'news-broker',
    name: 'News Broker Plugin',
    description: 'Provides an API for other plugins to offer news data to the assistant, ' +
      'and for other plugins to request news data from any plugin that offers it.',
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

    const newsProviderCallbacks: Record<string, (query: string) => Promise<NewsItem[]>> = {};

    plugin.offer<'news-broker'>({
      registerNewsProvider: (name, callback) => {
        // Store the callback and call it whenever we want to get news from this provider.
        newsProviderCallbacks[name] = callback;
      },
      requestNewsData: async (query) => {
        // Call all registered news providers' callbacks with the query and return the results in an object 
        // keyed by provider name, or return an empty object if no providers are registered.
        if (Object.keys(newsProviderCallbacks).length === 0) {
          return {};
        }

        const results: Record<string, NewsItem[]> = {};
        await Promise.all(Object.entries(newsProviderCallbacks).map(async ([name, callback]) => {
          results[name] = await callback(query);
        }));
        return results;
      },
    });
  }
};

export default newsBrokerPlugin;
