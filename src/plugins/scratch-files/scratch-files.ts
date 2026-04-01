import { Type } from 'typebox';
import { AlicePlugin } from '../../lib.js';
import appendScratchFileTool from './tools/append-scratch-file.js';
import deleteScratchFileTool from './tools/delete-scratch-file.js';
import listScratchFilesTool from './tools/list-scratch-files.js';
import readScratchFileTool from './tools/read-scratch-file.js';
import writeScratchFileTool from './tools/write-scratch-file.js';

export const ScratchFilesPluginConfigSchema = Type.Object({
  scratchDirectory: Type.String({ default: '~/.alice/scratch' }),
  allowedFileTypes: Type.Array(Type.String(), { default: ['txt', 'md'] }),
  maxFileSizeKB: Type.Number({ default: 100 }),
  allowOverwrite: Type.Boolean({ default: true }),
});

export type ScratchFilesPluginConfigSchema = Type.Static<typeof ScratchFilesPluginConfigSchema>;

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

    const config = await plugin.config(ScratchFilesPluginConfigSchema, {
      scratchDirectory: '~/.alice/scratch',
      allowedFileTypes: ['txt', 'md', 'log'],
      maxFileSizeKB: 100,
      allowOverwrite: true,
    });

    plugin.registerTool(appendScratchFileTool(config.getPluginConfig()));
    plugin.registerTool(deleteScratchFileTool(config.getPluginConfig()));
    plugin.registerTool(listScratchFilesTool(config.getPluginConfig()));
    plugin.registerTool(readScratchFileTool(config.getPluginConfig()));
    plugin.registerTool(writeScratchFileTool(config.getPluginConfig()));
  }
};

export default scratchFilesPlugin;
