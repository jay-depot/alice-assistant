import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const webSearchBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
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
  }
};

export default webSearchBrokerPlugin;
