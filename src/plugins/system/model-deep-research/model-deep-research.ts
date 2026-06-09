import { AlicePlugin } from '../../../lib.js';

const modelDeepResearchPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'model-deep-research',
    name: 'Model Deep Research',
    brandColor: '#a1887f',
    description:
      'Registers the agent-tier useFor=deep-research route for autonomous research agents.',
    version: 'LATEST',
    dependencies: [{ id: 'llm-provider-broker', version: 'LATEST' }],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const llmProviderBroker = plugin.request('llm-provider-broker');

    if (!llmProviderBroker) {
      throw new Error(
        'Model Deep Research: llm-provider-broker is unavailable. Enable llm-provider-broker before model-deep-research.'
      );
    }

    plugin.logger.log(
      'registerPlugin: Registering agent-tier useFor=deep-research route.'
    );
    llmProviderBroker.registerLlmUseFor({
      id: 'deep-research',
      tier: 'agent',
      description:
        'Agent-level route for deep-dive research agents that need intensive web research capabilities.',
      qualifies: context => context.conversationType === 'deep-dive-research',
    });
    plugin.logger.log(
      'registerPlugin: Agent-tier useFor=deep-research route registered.'
    );
  },
};

export default modelDeepResearchPlugin;
