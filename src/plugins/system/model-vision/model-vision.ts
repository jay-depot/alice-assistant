import { AlicePlugin } from '../../../lib.js';

const VISION_HINT_PATTERN =
  /(screen(?:shot)?|see\s+my\s+screen|look\s+at\s+(?:this\s+)?image|analy[sz]e\s+(?:this\s+)?image|inspect\s+(?:this\s+)?image)/i;

const modelVisionPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'model-vision',
    name: 'Model Vision',
    brandColor: '#4fc3f7',
    description:
      'Registers the shared useFor=vision route so other plugins can depend on it without re-declaring routing rules.',
    version: 'LATEST',
    dependencies: [{ id: 'llm-provider-broker', version: 'LATEST' }],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const llmProviderBroker = plugin.request('llm-provider-broker');

    if (!llmProviderBroker) {
      throw new Error(
        'Model Vision: llm-provider-broker is unavailable. Enable llm-provider-broker before model-vision.'
      );
    }

    plugin.logger.log(
      'registerPlugin: Registering shared useFor=vision route.'
    );
    llmProviderBroker.registerLlmUseFor({
      id: 'vision',
      tier: 'task',
      description:
        'Handles requests that include image input or explicit visual inspection intent.',
      priority: 25,
      qualifies: context => {
        if (context.hasVisionInput) {
          return true;
        }

        return VISION_HINT_PATTERN.test(context.latestUserMessage || '');
      },
    });
    plugin.logger.log('registerPlugin: Shared useFor=vision route registered.');
  },
};

export default modelVisionPlugin;
