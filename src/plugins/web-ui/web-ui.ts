import { AlicePlugin } from '../../lib/types/alice-plugin-interface.js';

const webUiPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'web-ui',
    name: 'Web UI Plugin',
    description: 'Provides the web interface for the assistant, and manages all interactions ' +
      'between the assistant and the web interface.',
    version: 'LATEST',
    dependencies: [
      { id: 'memory', version: 'LATEST' },
    ], // probably no plugins should depend on this one, since it's so core to the assistant's functionality. Should we enforce that somehow?
    required: true,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(webUiPlugin.pluginMetadata); 
    const { registerDatabaseModels, onDatabaseReady, saveMemory } = plugin.request('memory');
  }
};

export default webUiPlugin;
