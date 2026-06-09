import { AlicePlugin } from '../../../lib.js';

const modelChatPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'model-chat',
    name: 'Model Chat',
    brandColor: '#81c784',
    description:
      'Registers the shared useFor=chat route so chat conversations select a dedicated model.',
    version: 'LATEST',
    dependencies: [{ id: 'llm-provider-broker', version: 'LATEST' }],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const llmProviderBroker = plugin.request('llm-provider-broker');

    if (!llmProviderBroker) {
      throw new Error(
        'Model Chat: llm-provider-broker is unavailable. Enable llm-provider-broker before model-chat.'
      );
    }

    plugin.logger.log('registerPlugin: Registering shared useFor=chat route.');
    llmProviderBroker.registerLlmUseFor({
      id: 'chat',
      description:
        'Handles text-based chat conversations in the web interface.',
      qualifies: context => context.conversationType === 'chat',
    });
    plugin.logger.log('registerPlugin: Shared useFor=chat route registered.');
  },
};

export default modelChatPlugin;
