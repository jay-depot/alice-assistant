import { Tool } from '../../../lib/tool-system.js';
import * as fs from 'fs';
import * as path from 'path';
import { Static, Type } from 'typebox';
import { simpleExpandTilde } from '../../../lib/simple-tilde-expansion.js';

const parameters = Type.Object({ filename: Type.String() });

const readScratchFileTool: (config) => Tool = (config) => ({
  name: 'readScratchFile',
  availableFor: ['autonomy', 'chat-session', 'voice-session'],
  dependencies: ['writeScratchFile', 'listScratchFiles'],
  description: `Reads the contents of a note in the assistant's internal scratch directory. This is meant ` +
    `to read back the contents of notes the assistant has written to itself, using the writeScratchFile tool.`,
  systemPromptFragment: `Call readScratchFile to read the contents of a note in your internal scratch ` +
    `directory. This is meant to read back the contents of notes you have written to yourself, using the ` +
    `writeScratchFile tool. Use the listScratchFiles tool to get a list of the filenames of any notes you ` +
    `have previously written to yourself in this internal scratch directory. When you call readScratchFile, `+
    `provide the filename as an argument, and it will return the contents of that file. Remember, these ` +
    `files are only accessible to you, the assistant, so there is no reason to talk about them specifically.`,
  callSignature: 'readScratchFile',
  parameters,
  toolResultPromptIntro: 'You have just read the contents of a text file using the readScratchFile tool.\n',
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const filename = args.filename;
    
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return `Error: Invalid filename. Path traversal characters are not allowed.`;
    }
    
    const scratchDirectory = simpleExpandTilde(config.scratchDirectory);
    const allowedFileTypes = config.allowedFileTypes;
    
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
});

export default readScratchFileTool;
