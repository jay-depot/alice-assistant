import { AlicePlugin } from '../../../lib.js';

const modelDeepThinkingPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'model-deep-thinking',
    name: 'Model Deep Thinking',
    brandColor: '#ff8a65',
    description:
      'Registers the task-tier useFor=deep-thinking route for switching to a more capable model mid-session.',
    version: 'LATEST',
    dependencies: [{ id: 'llm-provider-broker', version: 'LATEST' }],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const llmProviderBroker = plugin.request('llm-provider-broker');

    if (!llmProviderBroker) {
      throw new Error(
        'Model Deep Thinking: llm-provider-broker is unavailable. Enable llm-provider-broker before model-deep-thinking.'
      );
    }

    plugin.logger.log(
      'registerPlugin: Registering task-tier useFor=deep-thinking route.'
    );
    llmProviderBroker.registerLlmUseFor({
      id: 'deep-thinking',
      tier: 'task',
      description:
        'Task-level route for deep-thinking / high-capability model selected explicitly via think_deeply.begin tool.',
      qualifies: () => false, // Never auto-match — only switched to via setPendingUseForOverride
    });
    plugin.logger.log(
      'registerPlugin: Task-tier useFor=deep-thinking route registered.'
    );
  },
};

export default modelDeepThinkingPlugin;
