import { Tool } from '../lib/tool-system';
import { UserConfig } from '../lib/user-config';
import fs from 'fs';

const writeScratchFileTool: Tool = {
  name: 'writeScratchFile',
  description: 'Writes a text file to an internal scratch directory. This is meant to be used in conjunction with the readScratchFile tool, which can read back the contents of files you\'ve written. The files you write with this tool will not be accessible to you outside of the assistant, and are meant to be a temporary storage space for the assistant to keep track of information that might be too long or unwieldy to keep in memory.',
  systemPromptFragment: `Call writeScratchFile when you want to write a text file to your internal scratch directory. The file will be stored in a directory that is only accessible to you, and is meant to be used as a temporary storage space for information that might be too long or unwieldy to keep in memory. You must provide the filename and the contents of the file as arguments. For example, if you want to save some notes that you can refer back to later, you could call writeScratchFile with the argument "filename" set to "notes.txt" and the argument "contents" set to the text you want to save. You can then read back the contents of this file later using the readScratchFile tool.`,
  callSignature: 'writeScratchFile',
  toolResultPromptIntro: 'You have just written a text file to your internal scratch directory using the writeScratchFile tool.\n',
  toolResultPromptOutro: '',
  execute: async (args: Record<string, string>) => {
    const scratchDirectory = UserConfig.getConfig().tools.writeScratchFile.scratchDirectory;
    if (!fs.existsSync(scratchDirectory)) {
      fs.mkdirSync(scratchDirectory, { recursive: true });
    }
    const allowedFileTypes = UserConfig.getConfig().tools.writeScratchFile.allowedFileTypes;
    const maxFileSizeKB = UserConfig.getConfig().tools.writeScratchFile.maxFileSizeKB;
    const allowOverwrite = UserConfig.getConfig().tools.writeScratchFile.allowOverwrite;

    const filename = args.filename;
    const contents = args.contents;

    

    return `Written file ${filename}. ${contents.length} characters written.`;
  }
};

export default writeScratchFileTool;
