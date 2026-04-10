import { AlicePlugin, AlicePluginInterface } from '../../../lib.js';
import { format } from 'date-fns';

const datetimePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'datetime',
    name: 'Date and Time Plugin',
    description: 'Provides the current date and time to the assistant.',
    version: 'LATEST',
    dependencies: [],
    required: true,
  },

  async registerPlugin(pluginInterface: AlicePluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.registerFooterSystemPrompt({
      name: 'datetimeFooter',
      weight: 99999,
      getPrompt: async () => {
        const systemPromptChunks: string[] = [];
        systemPromptChunks.push(`## CURRENT DATE AND TIME\n`);
        systemPromptChunks.push(`The current date and time are: ${format(new Date(), 'PPP pp')}`);
        systemPromptChunks.push(`The current day of the week is: ${format(new Date(), 'EEEE')}`);
        return systemPromptChunks.join('\n');
      }
    });
  }
};

export default datetimePlugin;
