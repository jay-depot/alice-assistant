import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import { type LightpandaFetchOptions, lightpanda } from '@lightpanda/browser'

const LightpandaFetchToolParameterSchema = Type.Object({
  url: Type.String({ description: 'The URL to fetch' }),
});

export type LightpandaFetchToolParameters = Type.Static<typeof LightpandaFetchToolParameterSchema>;

const lightpandaBrowserPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'lightpanda-browser',
    name: 'LightPanda Browser Plugin',
    description: 'Lets your assistant fetch (some) web pages using the lightpanda browser',
    version: 'LATEST',
    dependencies: [],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    
    plugin.registerTool({
      name: 'lightpandaFetch',
      description: 'Call lightpandaFetch when the user asks you to fetch a web page for ' + 
        'them, or information from a web page, or information available on a web page, or ' +
        'when you need information that can be found on a web page to complete an assigned ' +
        'task. lightpanda is a *fast* web browser designed for you! It turns web pages into ' +
        'text you can read.',
      parameters: LightpandaFetchToolParameterSchema,
      availableFor: ['chat', 'voice'],
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (parameters: LightpandaFetchToolParameters) => {
        const { url } = parameters;
        const fetchOptions: LightpandaFetchOptions = {
          dump: true,
          dumpOptions: {
            type: 'markdown',
          },
        };
        try {
          const response = await lightpanda.fetch(url, fetchOptions);
          return 'CONTENTS OF PAGE AT: '+ url + '\n=========\n\n' + response;
        } catch (error) {
          console.error('Error fetching URL with lightpanda:', error);
          return 'There was an error while trying to fetch the page at ' + url;
        }
      },
    });
  }
};

export default lightpandaBrowserPlugin;
