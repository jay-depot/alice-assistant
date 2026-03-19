import { Tool } from '../lib/tool-system';
import * as fs from 'fs';
import { UserConfig } from '../lib/user-config';
import { Type } from '@sinclair/typebox';

const listScratchFilesTool: Tool = {
  name: 'listScratchFiles',
  dependencies: ['writeScratchFile', 'readScratchFile'],
  description: 'Lists the files in the internal scratch directory. This is meant to be used in conjunction with the writeScratchFile and readScratchFile tools, which allow you to write and read text files in this scratch directory. You can call this tool with no arguments to get a list of the filenames of the files currently in the scratch directory.',
  systemPromptFragment: `Call listScratchFiles with no arguments to get a list of the filenames of the files currently in your internal scratch directory. This is meant to be used in conjunction with the writeScratchFile and readScratchFile tools, which allow you to write and read text files in this scratch directory.`,
  callSignature: 'listScratchFiles',
  parameters: Type.Object({}),
  toolResultPromptIntro: '',
  toolResultPromptOutro: '',

  execute: async () => {
    const scratchDirectory = UserConfig.getConfig().tools.writeScratchFile.scratchDirectory;
    const allowedFileTypes = UserConfig.getConfig().tools.writeScratchFile.allowedFileTypes;

    if (!fs.existsSync(scratchDirectory)) {
      return `Your scratch directory is currently empty.`;
    }

    const files = fs.readdirSync(scratchDirectory);

    if (files.length === 0) {
      return `Your scratch directory is currently empty.`;
    }

    return `Files in your scratch directory:\n${files.filter((file: string) => allowedFileTypes.includes(file.split('.').pop() || '')).join('\n')}\n\n Total files: ${files.length}`;
  }
};

export default listScratchFilesTool;
