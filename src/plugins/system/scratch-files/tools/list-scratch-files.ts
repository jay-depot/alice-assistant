import { Tool } from '../../../../lib/tool-system.js';
import * as fs from 'fs';
import { Type } from 'typebox';
import { simpleExpandTilde } from '../../../../lib/simple-tilde-expansion.js';
import { ScratchFilesPluginConfigSchema } from '../scratch-files.js';

const listScratchFilesTool: (
  config: ScratchFilesPluginConfigSchema
) => Tool = config => ({
  name: 'listScratchFiles',
  availableFor: ['autonomy', 'chat', 'voice'],
  description:
    `Lists the files in the assistant's internal scratch directory. This is meant ` +
    `to be used in conjunction with the updateScratchFile and readScratchFile tools, which allow ` +
    `you to write and read text files in this scratch directory. You can call this tool with no ` +
    `arguments to get a list of the filenames of the files currently in your scratch directory.`,
  systemPromptFragment:
    `Call listScratchFiles with no arguments to get a list of the filenames of ` +
    `any notes you have previously written to yourself in your internal scratch directory. This ` +
    `is meant to be used in conjunction with the updateScratchFile and readScratchFile tools, ` +
    `which allow you to write and read these notes.`,
  parameters: Type.Object({}),
  toolResultPromptIntro: '',
  toolResultPromptOutro: '',

  execute: async () => {
    const scratchDirectory = simpleExpandTilde(config.scratchDirectory);
    const allowedFileTypes = config.allowedFileTypes;

    if (!fs.existsSync(scratchDirectory)) {
      return `Your internal scratch directory is currently empty.`;
    }

    const files = fs.readdirSync(scratchDirectory);

    if (files.length === 0) {
      return `Your internal scratch directory is currently empty.`;
    }

    const filteredFiles = files.filter((file: string) =>
      allowedFileTypes.includes(file.split('.').pop() || '')
    );

    if (filteredFiles.length === 0) {
      return `Your internal scratch directory contains no files of the allowed types (${allowedFileTypes.join(', ')}).`;
    }

    return `Files in your internal scratch directory:\n${filteredFiles.join('\n')}\n\n Total files: ${filteredFiles.length} \nUse the readScratchFile tool with the filename as an argument to read the contents of any of these files. Use the updateScratchFile tool to create new files in this directory, or update existing ones. Use the deleteScratchFile tool to delete any of these files when you no longer need them. Remember, these files are only accessible to you, the assistant, so there is no reason to talk about them specifically.`;
  },
});

export default listScratchFilesTool;
