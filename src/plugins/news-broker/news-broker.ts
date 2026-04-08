import Type from 'typebox';
import { AlicePlugin } from '../../lib.js';

type NewsItem = {
  headline: string;
  preview?: string;
  url: string;
  source: string;
  age: string;
};


const NewsToolParametersSchema = Type.Object({
  query: Type.String({ description: 'The news topic to search for. This can be as broad or specific as you like, but should be focused on a particular topic or event.' }),
});
export type NewsToolParametersSchema = Type.Static<typeof NewsToolParametersSchema>;

declare module '../../lib.js' {
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
    const plugin = await pluginInterface.registerPlugin();

    const newsProviderCallbacks: Record<string, (query: string) => Promise<NewsItem[]>> = {};

    const requestNewsData = async (query: string): Promise<Record<string, NewsItem[]>> => {
              // Call all registered news providers' callbacks with the query and return the results in an object 
        // keyed by provider name, or return an empty object if no providers are registered.
        if (Object.keys(newsProviderCallbacks).length === 0) {
          return {};
        }

        const results: Record<string, NewsItem[]> = {};
        const cleanedQuery = query
          .trim()
          .toLowerCase()
          .split(' ')
          .filter(word => ![
            'news',
            'about',
            'on',
            'regarding',
            'related to',
            'headlines',
            'latest',
            'today',
            'yesterday',
            'tomorrow',
            new Date().getFullYear().toString(),
            new Date().getDay().toString(),
            new Date().toLocaleString('default', { month: 'long' }).toLowerCase(),
            new Date().toLocaleString('default', { month: 'short' }).toLowerCase(),
          ].includes(word)).join(' ');
        await Promise.all(Object.entries(newsProviderCallbacks).map(async ([name, callback]) => {
          results[name] = await callback(cleanedQuery);
        }));
        return results;
    }

    plugin.offer<'news-broker'>({
      registerNewsProvider: (name, callback) => {
        // Store the callback and call it whenever we want to get news from this provider.
        newsProviderCallbacks[name] = callback;
      },
      requestNewsData,
    });

    plugin.registerTool({
      name: 'getNews',
      parameters: NewsToolParametersSchema,
      availableFor: ['chat', 'voice', 'autonomy'],
      description: 'Gets news data related to a specific query from any plugin that offers it ' +
        'through the news broker plugin. The query can be as broad or specific as you like, ' +
        'but should be focused on a particular topic or event. The tool will return an object ' +
        'containing news data from all registered news providers that have relevant data for ' +
        'the query, keyed by provider name.',
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: (type) => type === 'chat' ? 'IMPORTANT: ALWAYS INCLUDE LINKS TO THE ARTICLES YOU ARE REFERENCING IN YOUR REPLY!' : '',
      execute: async (parameters: NewsToolParametersSchema) => {
        const newsData = await requestNewsData(parameters.query);
        const formattedResults = Object.entries(newsData).map(([provider, items]) => {
          const formattedItems = items.map(item => `- ${item.headline} (${item.source}, ${item.age} ago)\n${item.preview ? `  ${item.preview}\n` : ''}  URL: ${item.url}\n`).join('\n');
          return `News from ${provider}:\n${formattedItems}`;
        }).join('\n\n');
        return formattedResults || 'No news data available for this query.';
      }
    })
  }
};

export default newsBrokerPlugin;
