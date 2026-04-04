import Type from 'typebox';
import { AlicePlugin } from '../../lib.js';

type WebSearchResult = {
  title: string;
  snippet: string;
  url: string;
};

const WebSearchBrokerPluginConfigSchema = Type.Object({
  preferredSearchProvider: Type.Optional(Type.String()),
});

type WebSearchBrokerPluginConfigSchema = Type.Static<typeof WebSearchBrokerPluginConfigSchema>;

declare module '../../lib.js' {
  export interface PluginCapabilities {
    'web-search-broker': {
      /**
       * Registers a web search provider to handle requests
       * @param name 
       * @param callback 
       * @returns void
       */
      registerWebSearchProvider: (name: string, callback: (query: string) => Promise<WebSearchResult[]>) => void;

      /**
       * Request a web search from all available providers.
       * @param query 
       * @returns A promise that resolves to the search result sets, keyed by provider ID
       */
      requestWebSearchData: (query: string) => Promise<Record<string, WebSearchResult[]>>;

      /**
       * Returns the ID of the user's configured "preferred" search provider.
       * @returns A promise that resolves to the ID of the configured "preferred search provider"
       */
      getPreferredProviderId: () => Promise<string>;
    }
  }
}

const WebSearchToolInputSchema = Type.Object({
  query: Type.String({ description: 'The search query to perform.' }),
});

type WebSearchToolInputSchema = Type.Static<typeof WebSearchToolInputSchema>;

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
    const plugin = await pluginInterface.registerPlugin();

    const webSearchProviderCallbacks: Record<string, (query: string) => Promise<WebSearchResult[]>> = {};

    const config = await plugin.config<WebSearchBrokerPluginConfigSchema>(WebSearchBrokerPluginConfigSchema, {});
    
    const requestWebSearchData = async (query: string) => {
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
    };

    const getPreferredProviderId = async () => {
      return config.getPluginConfig().preferredSearchProvider || '';
    }

    plugin.offer<'web-search-broker'>({
      registerWebSearchProvider: (name, callback) => {
        // Store the callback and call it whenever we want to get web search results from this provider.
        webSearchProviderCallbacks[name] = callback;
      },
      requestWebSearchData,
      getPreferredProviderId,
    });

    plugin.registerTool({
      name: 'webSearch',
      description: 'Use webSearch to perform a web search on behalf of the user, or if you absolutely cannot answer the user\'s question using your own knowledge. The tool will return results from one or more search providers.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      parameters: WebSearchToolInputSchema,
      execute: async (parameters: WebSearchToolInputSchema) => {
        const results = await requestWebSearchData(parameters.query);
        const resultsStringPars = [] as string[];
        for (const [provider, providerResults] of Object.entries(results)) {
          const providerResultsString = `## Results from ${provider}\n` + providerResults.map((result, index) => {
            return `Result ${index + 1}:\nTitle: ${result.title}\nSnippet: ${result.snippet}\nURL: ${result.url}`;
          }).join('\n');
          resultsStringPars.push(providerResultsString);
        }
        return resultsStringPars.join('\n\n');
      }
    });
  }
};

export default webSearchBrokerPlugin;
