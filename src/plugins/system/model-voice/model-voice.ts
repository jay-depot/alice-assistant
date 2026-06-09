import { AlicePlugin } from '../../../lib.js';

const modelVoicePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'model-voice',
    name: 'Model Voice',
    brandColor: '#ba68c8',
    description:
      'Registers the shared useFor=voice route so voice interactions select a dedicated model.',
    version: 'LATEST',
    dependencies: [{ id: 'llm-provider-broker', version: 'LATEST' }],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const llmProviderBroker = plugin.request('llm-provider-broker');

    if (!llmProviderBroker) {
      throw new Error(
        'Model Voice: llm-provider-broker is unavailable. Enable llm-provider-broker before model-voice.'
      );
    }

    plugin.logger.log('registerPlugin: Registering shared useFor=voice route.');
    llmProviderBroker.registerLlmUseFor({
      id: 'voice',
      description:
        'Handles wake-word-driven voice interactions that should produce short spoken replies.',
      qualifies: context => context.conversationType === 'voice',
    });
    plugin.logger.log('registerPlugin: Shared useFor=voice route registered.');
  },
};

export default modelVoicePlugin;
