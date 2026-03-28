import { Static, Type } from '@sinclair/typebox';
import { Tool } from '../../../lib/tool-system.js';
import * as fs from 'fs';
import * as path from 'path';
import { UserConfig } from '../../../lib/user-config.js';
import { simpleExpandTilde } from '../../../lib/simple-tilde-expansion.js';

const parameters = Type.Object({ filename: Type.String() });

const deleteScratchFileTool: Tool = {
  name: 'deleteScratchFile',
  availableFor: ['autonomy', 'chat-session', 'voice-session'],
  dependencies: ['writeScratchFile', 'readScratchFile', 'listScratchFiles'],
  description: 'Deletes a text file from the internal scratch directory. This is meant to be used in conjunction with the ' +
    'writeScratchFile, readScratchFile, and listScratchFiles tools, which allow you to write, read, and list text files in ' +
    'this scratch directory. You can call this tool with the filename of the file you want to delete as an argument.',
  systemPromptFragment: `Call deleteScratchFile when you want to delete a text file from your internal scratch directory. ` +
    `The file must be located in your scratch directory, and you must provide the filename as an argument. For example, if ` +
    `you previously wrote a file named "notes.txt" using the writeScratchFile tool and no longer need it, you would call ` +
    `deleteScratchFile with the argument "filename" set to "notes.txt" to delete it.`,
  callSignature: 'deleteScratchFile',
  parameters,
  toolResultPromptIntro: 'You have just deleted a text file from your internal scratch directory using the deleteScratchFile tool.\n',
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const filename = args.filename;
    const allowedFileTypes = UserConfig.getConfig().toolSettings.writeScratchFile.allowedFileTypes;
    const scratchDirectory = simpleExpandTilde(UserConfig.getConfig().toolSettings.writeScratchFile.scratchDirectory);

    if (!allowedFileTypes.includes(filename.split('.').pop() || '')) {
      return `Error: File type not allowed.`;
    }

    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return `Error: Invalid filename. Path traversal characters are not allowed.`;
    }

    const filePath = path.join(scratchDirectory, filename);

    if (!fs.existsSync(filePath)) {
      return `Error: File ${filename} does not exist.`;
    }

    fs.unlinkSync(filePath);
    return `Deleted file ${filename}.`;
  }
};

export default deleteScratchFileTool;
