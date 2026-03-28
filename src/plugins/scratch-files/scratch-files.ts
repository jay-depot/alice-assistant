import { AlicePlugin } from '../../lib/types/alice-plugin-interface.js';
import appendScratchFileTool from './tools/append-scratch-file.js';
import deleteScratchFileTool from './tools/delete-scratch-file.js';
import listScratchFilesTool from './tools/list-scratch-files.js';
import readScratchFileTool from './tools/read-scratch-file.js';
import writeScratchFileTool from './tools/write-scratch-file.js';

const scratchFilesPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'scratch-files',
    name: 'Scratch Files Plugin',
    description: 'Provides the assistant with the ability to create and manage scratch files. ' +
      'These are temporary files that can be used for jotting down notes, saving information, or ' +
      'any other purpose the assistant deems fit.',
    version: 'LATEST',
    dependencies: [],
    required: true,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(scratchFilesPlugin.pluginMetadata);

    plugin.registerTool(appendScratchFileTool);
    plugin.registerTool(deleteScratchFileTool);
    plugin.registerTool(listScratchFilesTool);
    plugin.registerTool(readScratchFileTool);
    plugin.registerTool(writeScratchFileTool);
  }
};

export default scratchFilesPlugin;
