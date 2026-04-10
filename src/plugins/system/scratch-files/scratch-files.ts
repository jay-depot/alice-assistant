import { Type } from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import appendScratchFileTool from './tools/append-scratch-file.js';
import deleteScratchFileTool from './tools/delete-scratch-file.js';
import listScratchFilesTool from './tools/list-scratch-files.js';
import readScratchFileTool from './tools/read-scratch-file.js';
import writeScratchFileTool from './tools/write-scratch-file.js';
import path from 'node:path';
import { exists, readFile } from '../../../lib/node/fs-promised.js';
import { reindexScratchFiles } from './scratch-files-index.js';
import { simpleExpandTilde } from '../../../lib/simple-tilde-expansion.js';
import { getConversationTypeDefinition } from '../../../lib/conversation-types.js';

export const ScratchFilesPluginConfigSchema = Type.Object({
  scratchDirectory: Type.String({ default: '~/.alice-assistant/scratch' }),
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
      'These are temporary files that it uses internally to save information between interactions. ' +
      'The assistant can create, read, update, and delete these files as needed.',
    version: 'LATEST',
    dependencies: [],
    required: true,
  },

  async registerPlugin(api) {
    const plugin = await api.registerPlugin();

    const config = await plugin.config(ScratchFilesPluginConfigSchema, {
      scratchDirectory: '~/.alice-assistant/scratch',
      allowedFileTypes: ['txt', 'md', 'log'],
      maxFileSizeKB: 100,
      allowOverwrite: true,
    });

    plugin.registerTool(appendScratchFileTool(config.getPluginConfig()));
    plugin.registerTool(deleteScratchFileTool(config.getPluginConfig()));
    plugin.registerTool(listScratchFilesTool(config.getPluginConfig()));
    plugin.registerTool(readScratchFileTool(config.getPluginConfig()));
    plugin.registerTool(writeScratchFileTool(config.getPluginConfig()));

    plugin.hooks.onAllPluginsLoaded(async () => {
      const scratchDir = simpleExpandTilde(config.getPluginConfig().scratchDirectory);
      const indexFilePath = path.join(scratchDir, '.index');

      if (await exists(indexFilePath)) {
        console.log('Scratch files index already exists, skipping indexing.');
        return;
      }

      console.log('Indexing scratch files...');
      await reindexScratchFiles(config.getPluginConfig());
      console.log('Scratch files indexing complete.');
    });

    plugin.registerHeaderSystemPrompt({
      name: 'scratch-files-header',
      weight: 10000,
      async getPrompt(context) {
        const conversationTypeDefinition = getConversationTypeDefinition(context.conversationType);
        if (!conversationTypeDefinition || conversationTypeDefinition.baseType === 'startup') {
          return false;
        }

        const indexFilePath = path.join(config.getPluginConfig().scratchDirectory, '.index');
        let indexContent : string;

        if (await exists(indexFilePath)) {
          const rawIndex = JSON.parse(await readFile(indexFilePath, 'utf-8'));
          indexContent = Object.entries(rawIndex)
            .map(([filename, summary]) => `- **${filename}**: ${summary}`)
            .join('\n');
          return '# Scratch Files Index\n\n' + indexContent;
        }

        return false;
      },
    });
  }
};

export default scratchFilesPlugin;
