import Type from 'typebox';
import { AlicePlugin } from '../../lib.js';

const CurrentsNewsPluginConfigSchema = Type.Object({
  // Optional so the plugin can create its config file. User will still need to set 
  // one for this to work.
  apiKey: Type.Optional(Type.String({ description: 'API key for Currents News API' })),
});

export type CurrentsNewsPluginConfigSchema = Type.Static<typeof CurrentsNewsPluginConfigSchema>;

const currentsNewsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'currents-news',
    name: 'Currents News Plugin',
    description: 'Uses Currents News API to provide a news source for the news broker plugin.',
    version: 'LATEST',
    dependencies: [
      { id: 'news-broker', version: 'LATEST' },
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { registerNewsProvider } = plugin.request('news-broker');

    const config = await plugin.config<CurrentsNewsPluginConfigSchema>(CurrentsNewsPluginConfigSchema, {});

    registerNewsProvider('currents-news', async (query) => {
      // For now we'll just return some dummy data until we implement the actual API calls to Currents News.
      return [
        {
          headline: 'Example News Item 1',
          preview: 'This is a preview of the first example news item.',
          url: 'https://example.com/news1',
          source: 'Example News Source',
          age: '2 hours ago',
        },
        {
          headline: 'Example News Item 2',
          preview: 'This is a preview of the second example news item.',
          url: 'https://example.com/news2',
          source: 'Example News Source',
          age: '30 minutes ago',
        },
      ];
    });
  }
};

export default currentsNewsPlugin;
