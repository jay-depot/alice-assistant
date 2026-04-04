import { SafeSearchLevel } from 'brave-search/dist/types.js';
import { AlicePlugin } from '../../lib/types/alice-plugin-interface.js';

const braveSearchNewsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'brave-search-news',
    name: 'Brave Search News Plugin',
    description: 'Uses Brave Search API to provide a news source for the news broker plugin.',
    version: 'LATEST',
    dependencies: [
      { id: 'brave-search-api', version: 'LATEST' },
      { id: 'news-broker', version: 'LATEST' },
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { getBraveSearchApiClient } = plugin.request('brave-search-api');
    const { registerNewsProvider } = plugin.request('news-broker');

    const braveSearch = getBraveSearchApiClient();
    if (!braveSearch) {
      console.warn('Brave Search News Plugin: Brave Search API client is not available. Please ensure the Brave Search API plugin is correctly configured.');
      return;
    }

    registerNewsProvider('brave-search-news', async (query) => {
      const apiResponse = await braveSearch.newsSearch(query, {
        count: 10,
        safesearch: SafeSearchLevel.Off,
        spellcheck: false,
      });

      const results = apiResponse.results || [];

      return results.map(result => ({
        headline: result.title,
        preview: result.description,
        age: result.page_age,
        url: result.url,
        source: result.source,
      }));
    });
  }
};

export default braveSearchNewsPlugin;
