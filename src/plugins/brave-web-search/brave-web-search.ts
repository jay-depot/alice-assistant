import { AlicePlugin } from '../../lib.js';
import { SafeSearchLevel } from 'brave-search/dist/types.js';

const braveWebSearchPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'brave-web-search',
    name: 'Brave Web Search Plugin',
    description: 'Provides an API for performing web searches using Brave Search. This plugin does not perform any web searches itself, but rather serves as a wrapper around the Brave Search API that other plugins can utilize to perform web searches and retrieve results.',
    version: 'LATEST',
    dependencies: [
      { id: 'brave-search-api', version: 'LATEST' },
      { id: 'web-search-broker', version: 'LATEST' }
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { getBraveSearchApiClient } = plugin.request('brave-search-api');
    const { registerWebSearchProvider } = plugin.request('web-search-broker');

    const braveSearch = getBraveSearchApiClient();
    if (!braveSearch) {
      console.warn('Brave Web Search Plugin: Brave Search API client is not available. Please ensure the Brave Search API plugin is correctly configured.');
      return;
    }

    registerWebSearchProvider('brave-web-search', async (query) => {
      const apiResponse = await braveSearch.webSearch(query, { 
        count: 5, 
        safesearch: SafeSearchLevel.Off,
        spellcheck: false, 
      });

      const results = apiResponse.web.results || [];

      return results.map(result => ({
        snippet: result.description,
        title: result.title,
        url: result.url,
      }));
    });
  }
};

export default braveWebSearchPlugin;
