import { AlicePlugin, getConversationTypeOwner, listConversationTypes } from '../../../lib.js';
import { AlicePluginEngine } from '../../../lib/alice-plugin-engine.js';

const troubleshootingPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'troubleshooting',
    name: 'Troubleshooting Plugin',
    description: 'Provides tools to help troubleshoot and debug your assistant when things go wrong.',
    version: 'LATEST',
    dependencies: [],
    required: false,
  },
  
  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.registerTool({
      name: 'getAssistantDebugInfo',
      description: 'Call getAssistantDebugInfo to get a dump of debug information about yourself, ' +
        'including loaded plugins, and conversation types. This is intended to be used for ' +
        'troubleshooting when something goes wrong.',
      parameters: [],
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      availableFor: ['chat', 'voice'],
      execute: async () => {
        const plugins = AlicePluginEngine.getLoadedPlugins();
        const conversationTypes = listConversationTypes().map(ct => ({
          id: ct.id,
          name: ct.name,
          description: ct.description,
          pluginId: getConversationTypeOwner(ct.id),
        }));

        return `Loaded plugins:\n${plugins.map(p => `- ${p.name} (id: ${p.id}, version: ${p.version})`).join('\n')}\n\n` +
          `Registered conversation types:\n${conversationTypes.map(ct => `- ${ct.name} (id: ${ct.id}, plugin: ${ct.pluginId})`).join('\n')}`;
      }
    });
  }
}

export default troubleshootingPlugin;
