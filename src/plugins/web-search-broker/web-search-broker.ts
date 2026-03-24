import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

type WebSearchResult = {
  title: string;
  snippet: string;
  url: string;
  source: string; // the name of the plugin that provided this search result
};

declare module '../../lib/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'web-search-broker': {
      // This API is intentionally minimal for now, and will likely expand in the future. 
      // For now, it just allows plugins to offer general purpose web search data in a standardized format, and to request general purpose web search data from any plugin that offers it.
      registerWebSearchProvider: (name: string, callback: (query: string) => Promise<WebSearchResult[]>) => void;
      requestWebSearchData: (query: string) => Promise<Record<string, WebSearchResult[]>>;
    }
  }
}

const webSearchBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'web-search-broker',
    name: 'Web Search Broker Plugin',
    description: 'Provides an API for other plugins to offer web search data to ' +
      'the assistant, and for other plugins to request general purpose web search ' +
      'data from any plugin that can provide it. "Specific topic" search engines ' +
      'should not be registered as providers for this plugin, and should instead ' +
      'provide their own search tools directly. Examples: brave-search, duckduckgo, ' +
      'google, bing, etc. should all be registered as providers here, while something ' +
      'like "arxiv search" or "pubmed search" or even a general "recipe search" should ' +
      'not be registered as a provider here and should instead just provide its own ' +
      'specialized search tool that the assistant can call directly.',
    version: 'LATEST',
    dependencies: [],
    required: false,
    system: true,
  },
  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(webSearchBrokerPlugin.pluginMetadata);

    const webSearchProviderCallbacks: Record<string, (query: string) => Promise<WebSearchResult[]>> = {};

    plugin.offer<'web-search-broker'>({
      registerWebSearchProvider: (name, callback) => {
        // Store the callback and call it whenever we want to get web search results from this provider.
        webSearchProviderCallbacks[name] = callback;
      },
      requestWebSearchData: async (query) => {
        // Call all registered web search providers' callbacks with the query and return the results in an object 
        // keyed by provider name, or return an empty object if no providers are registered.
        if (Object.keys(webSearchProviderCallbacks).length === 0) {
          return {};
        }

        const results: Record<string, WebSearchResult[]> = {};
        await Promise.all(Object.entries(webSearchProviderCallbacks).map(async ([name, callback]) => {
          results[name] = await callback(query);
        }));
        return results;
      },
    });
  }
};

export default webSearchBrokerPlugin;
