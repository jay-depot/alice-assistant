import { AlicePlugin } from '../../../lib.js';

const modelAutonomyPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'model-autonomy',
    name: 'Model Autonomy',
    brandColor: '#fff176',
    description:
      'Registers the shared useFor=autonomy route so autonomous workflows select a dedicated model.',
    version: 'LATEST',
    dependencies: [{ id: 'llm-provider-broker', version: 'LATEST' }],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const llmProviderBroker = plugin.request('llm-provider-broker');

    if (!llmProviderBroker) {
      throw new Error(
        'Model Autonomy: llm-provider-broker is unavailable. Enable llm-provider-broker before model-autonomy.'
      );
    }

    plugin.logger.log(
      'registerPlugin: Registering shared useFor=autonomy route.'
    );
    llmProviderBroker.registerLlmUseFor({
      id: 'autonomy',
      description:
        'Handles limited-autonomy workflows triggered by timers, events, or other plugin-driven activity.',
      qualifies: context => context.conversationType === 'autonomy',
    });
    plugin.logger.log(
      'registerPlugin: Shared useFor=autonomy route registered.'
    );
  },
};

export default modelAutonomyPlugin;
