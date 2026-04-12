import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';

const CurrentsNewsPluginConfigSchema = Type.Object({
  // Optional so the plugin can create its config file. User will still need to set
  // one for this to work.
  apiKey: Type.Optional(
    Type.String({ description: 'API key for Currents News API' })
  ),
});

export type CurrentsNewsPluginConfigSchema = Type.Static<
  typeof CurrentsNewsPluginConfigSchema
>;

// Typical Currents News API response:
// {
//   "status": "ok",
//   "news": [
//     {
//       "id": "uuid",
//       "title": "string",
//       "description": "string",
//       "url": "string",
//       "author": "string|null",
//       "image": "string|null",
//       "language": "string",
//       "category": ["string", "..."],
//       "published": "timestamp string"
//     }
//   ],
//   "page": 1
// }

type CurrentsAPIResponse = {
  status: string;
  news: {
    id: string;
    title: string;
    description: string;
    url: string;
    author: string | null;
    image: string | null;
    language: string;
    category: string[];
    published: string;
  }[];
  page: number;
};

const currentsNewsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'currents-news',
    name: 'Currents News Plugin',
    description:
      'Uses Currents News API to provide a news source for the news broker plugin.',
    version: 'LATEST',
    dependencies: [{ id: 'news-broker', version: 'LATEST' }],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { registerNewsProvider } = plugin.request('news-broker');

    const config = await plugin.config<CurrentsNewsPluginConfigSchema>(
      CurrentsNewsPluginConfigSchema,
      {}
    );

    const { apiKey } = config.getPluginConfig();

    if (!apiKey) {
      console.warn(
        'Currents News Plugin: No API key provided in config, news provider will not be registered.'
      );
      return;
    }

    registerNewsProvider('currents-news', async query => {
      // curl "https://api.currentsapi.services/v1/search?keywords=technology&language=en&page_number=1&page_size=5&apiKey=YOUR_API_KEY"
      // TODO: Set up language detection and pass the correct one instead of assuming `en`.
      const url = `https://api.currentsapi.services/v1/search?keywords=${encodeURIComponent(query)}&language=en&page_number=1&page_size=5&apiKey=${encodeURIComponent(apiKey)}`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.error(
            `Currents News Plugin: Failed to fetch news data, status ${response.status}`
          );
          return [];
        }
        const data: CurrentsAPIResponse = await response.json();
        return data.news.map(item => ({
          headline: item.title,
          preview: item.description,
          url: item.url,
          source: item.author, // Currents doesn't easily expose "source" the way we think of it, but the author is a good alternative.
          age: item.published,
        }));
      } catch (error) {
        console.error(
          `Currents News Plugin: Error fetching news data: ${error}`
        );
        return [];
      }
    });
  },
};

export default currentsNewsPlugin;
