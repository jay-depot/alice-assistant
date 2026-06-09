import { AlicePlugin } from '../../../lib.js';
import {
  closeLlmProviderRegistration,
  getActiveLlmProvider,
  listRegisteredLlmUseFor,
  registerLlmUseFor,
  resolveLlmProviderForRequest,
  validateConfiguredLlmUseFor,
  listRegisteredLlmProviders,
  registerLlmProvider,
  setPendingUseForOverride,
  type ActiveLlmProvider,
  type LlmProviderRegistration,
  type LlmRoutingContext,
  type LlmUseForRegistration,
} from '../../../lib/llm-provider.js';
import { UserConfig } from '../../../lib/user-config.js';

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'llm-provider-broker': {
      registerLlmProvider: (provider: LlmProviderRegistration) => void;
      registerLlmUseFor: (useFor: LlmUseForRegistration) => void;
      listRegisteredLlmProviders: () => string[];
      listRegisteredLlmUseFor: () => string[];
      getActiveLlmProvider: () => ActiveLlmProvider;
      resolveLlmProviderForRequest: (
        context: LlmRoutingContext
      ) => ActiveLlmProvider;
      setPendingUseForOverride: (useFor: string | undefined) => void;
    };
  }
}

const llmProviderBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'llm-provider-broker',
    name: 'LLM Provider Broker',
    brandColor: '#ff8c42',
    description:
      'Registers LLM providers offered by plugins and validates the active fallback model selection.',
    version: 'LATEST',
    dependencies: [],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.offer<'llm-provider-broker'>({
      registerLlmProvider,
      registerLlmUseFor,
      listRegisteredLlmProviders,
      listRegisteredLlmUseFor,
      getActiveLlmProvider: () => getActiveLlmProvider(UserConfig.getConfig()),
      resolveLlmProviderForRequest: context =>
        resolveLlmProviderForRequest(UserConfig.getConfig(), context),
      setPendingUseForOverride,
    });

    plugin.hooks.onAllPluginsLoaded(async () => {
      plugin.logger.log(
        'onAllPluginsLoaded: Finalizing LLM provider registration.'
      );
      closeLlmProviderRegistration();
      validateConfiguredLlmUseFor(UserConfig.getConfig());
      const active = getActiveLlmProvider(UserConfig.getConfig());
      plugin.logger.log(
        `onAllPluginsLoaded: Active fallback provider resolved to ${active.model.provider}:${active.model.model}.`
      );
    });
  },
};

export default llmProviderBrokerPlugin;
