import { AlicePlugin } from '../../../lib.js';

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'model-deep-research': {
      registerDeepResearchConversationType: (type: string) => void;
    };
  }
}

const registeredConversationTypes = new Set<string>();

const modelDeepResearchPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'model-deep-research',
    name: 'Model Deep Research',
    brandColor: '#a1887f',
    description:
      'Registers the agent-tier useFor=deep-research route for autonomous research agents. ' +
      'Other plugins register their conversation types via the offered API.',
    version: 'LATEST',
    dependencies: [{ id: 'llm-provider-broker', version: 'LATEST' }],
    required: false,
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
      'registerPlugin: Offering registerDeepResearchConversationType API.'
    );
    plugin.offer<'model-deep-research'>({
      registerDeepResearchConversationType: (type: string) => {
        registeredConversationTypes.add(type);
        plugin.logger.log(
          `registerDeepResearchConversationType: Registered "${type}" for deep-research routing.`
        );
      },
    });

    plugin.logger.log(
      'registerPlugin: Registering agent-tier useFor=deep-research route.'
    );
    llmProviderBroker.registerLlmUseFor({
      id: 'deep-research',
      tier: 'agent',
      description:
        'Agent-level route for deep-dive research agents that need intensive web research capabilities.',
      qualifies: context =>
        registeredConversationTypes.has(context.conversationType ?? ''),
    });
    plugin.logger.log(
      'registerPlugin: Agent-tier useFor=deep-research route registered.'
    );
  },
};

export default modelDeepResearchPlugin;
