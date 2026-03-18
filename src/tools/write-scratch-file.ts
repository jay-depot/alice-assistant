import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../lib/tool-system';
import { UserConfig } from '../lib/user-config';

const writeScratchFileTool: Tool = {
  name: 'writeScratchFile',
  dependencies: ['readScratchFile', 'listScratchFiles'],
  description: 'Writes a text file to an internal scratch directory. This is meant to be used in conjunction with the ' +
    'readScratchFile tool, which can read back the contents of files you\'ve written. The files you write with this tool ' +
    'will not be accessible to you outside of the assistant, and are meant to be a temporary storage space for the assistant ' +
    'to keep bits of information between sessions.',
  systemPromptFragment: `Call writeScratchFile when you want to write a text file to your internal scratch directory. ` +
    `The file will be stored in a directory that is only accessible to you, and is meant to store information you need ` +
    `preserved between sessions. Do not use this tool to store interaction logs. You must provide the filename ` +
    `and the contents of the file as arguments. For example, if you want to save some notes that you can refer back to ` +
    `later, you could call writeScratchFile with the argument "filename" set to "notes.txt" and the argument "contents" ` +
    `set to the text you want to save. You can then read back the contents of this file later using the readScratchFile tool. ` +
    `You may only use the extensions ${UserConfig.getConfig().tools.writeScratchFile.allowedFileTypes.join(', ')} for the ` +
    `filename, and the contents of the file must not exceed ${UserConfig.getConfig().tools.writeScratchFile.maxFileSizeKB} ` +
    `KB in size. You should also ensure that the filename does not contain any path traversal characters.`,
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

    if (!allowedFileTypes.includes(filename.split('.').pop() || '')) {
      return `Error: File type not allowed.`;
    }

    if (contents.length > maxFileSizeKB * 1024) {
      return `Error: File size exceeds the maximum allowed size of ${maxFileSizeKB} KB.`;
    }

    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return `Error: Invalid filename. Path traversal characters are not allowed.`;
    }

    const filePath = path.join(scratchDirectory, filename);
    if (fs.existsSync(filePath) && !allowOverwrite) {
      return `Error: File already exists and overwriting is not allowed.`;
    }

    fs.writeFileSync(filePath, contents);

    return `Written file ${filename}. ${contents.length} characters written.\nErrors: none.`;
  }
};

export default writeScratchFileTool;
