import { Tool } from '../lib/tool-system';
import * as fs from 'fs';
import * as path from 'path';
import { UserConfig } from '../lib/user-config';
import { Static, Type } from '@sinclair/typebox';

const parameters = Type.Object({ filename: Type.String() });

const readScratchFileTool: Tool = {
  name: 'readScratchFile',
  dependencies: ['writeScratchFile', 'listScratchFiles'],
  description: 'Reads the contents of an internal text file. This is meant to read back the contents of files ' +
    'the assistant has written to itself, using the writeScratchFile tool.',
  systemPromptFragment: `Call readScratchFile when you want to read the contents of a text file that you have previously written using the writeScratchFile tool. The file must be located in your scratch directory, and you must provide the filename as an argument. For example, if you previously wrote a file named "notes.txt" using the writeScratchFile tool, you would call readScratchFile with the argument "filename" set to "notes.txt" to read its contents.`,
  callSignature: 'readScratchFile',
  parameters,
  toolResultPromptIntro: 'You have just read the contents of a text file using the readScratchFile tool.\n',
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const filename = args.filename;
    
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return `Error: Invalid filename. Path traversal characters are not allowed.`;
    }
    
    const scratchDirectory = UserConfig.getConfig().toolSettings.writeScratchFile.scratchDirectory;
    const allowedFileTypes = UserConfig.getConfig().toolSettings.writeScratchFile.allowedFileTypes;
    
    if (!allowedFileTypes.includes(filename.split('.').pop() || '')) {
      return `Error: File type not allowed.`;
    }

    const filePath = path.join(scratchDirectory, filename);

    if (!fs.existsSync(filePath)) {
      return `Error: File ${filename} does not exist.`;
    }

    const contents = fs.readFileSync(filePath, 'utf-8');
    return `Contents of file ${filename} :\n== BEGIN FILE ==\n${contents}\n== END FILE ==`;
  }
};

export default readScratchFileTool;
