import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const scratchFilesPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'scratch-files',
    name: 'Scratch Files Plugin',
    description: 'Provides the assistant with the ability to create and manage scratch files. These are temporary files that can be used for jotting down notes, saving information, or any other purpose the assistant deems fit. The assistant should manage these files responsibly, deleting them when they are no longer needed to avoid clutter.',
    version: 'LATEST',
    dependencies: [],
    required: true,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(scratchFilesPlugin.pluginMetadata);
  }
};

export default scratchFilesPlugin;
