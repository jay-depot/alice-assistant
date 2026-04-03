import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../../../lib/tool-system.js';
import { Static, Type } from 'typebox';
import { simpleExpandTilde } from '../../../lib/simple-tilde-expansion.js';
import { ScratchFilesPluginConfigSchema } from '../scratch-files.js';
import { freshenScratchFilesIndex } from '../scratch-files-index.js';

const parameters = Type.Object({ filename: Type.String(), contents: Type.String() });

const writeScratchFileTool: (config: ScratchFilesPluginConfigSchema) => Tool = (config) => ({
  name: 'writeScratchFile',
  availableFor: ['autonomy', 'chat', 'voice'],
  description: 'Allows the assistant to write notes for itself in an internal scratch directory. This is meant to be used in conjunction with the ' +
    'readScratchFile tool, which can read back the contents of files the assistant has written. The files the assistant writes with this tool ' +
    'will not be directly accessible to user, and are meant to be a place for the assistant to write "notes to itself" for later.',
  systemPromptFragment: `Call writeScratchFile when you want to write a text file to your internal scratch ` +
    `directory. These are notes you write to yourself, so there is no need to mention them to the user. Use ` +
    `this tool to store information that should be preserved between sessions. Do not use this tool to store ` +
    `interaction summaries. That is handled by other tools. Use this at your discretion to enhance your performance, ` +
    `for example by writing yourself notes about user preferences, frequent conversation topics, reminders ` +
    `for yourself or the user, exact quotes, precise interaction transcriptions, and notes to yourself for ` +
    `long-term planning. You must provide the filename and the contents of the file as arguments. For example, ` +
    `if you want to save some notes that you can refer back to later, you could call writeScratchFile with the ` +
    `argument "filename" set to "notes.txt" and the argument "contents" set to the text you want to save. You can ` +
    `then read back the contents of this file later using the readScratchFile tool. You may only use the extensions ` +
    `[${config.allowedFileTypes.join(', ')}] for the filename, and the ` +
    `contents of the file must not exceed ${config.maxFileSizeKB} ` +
    `KB in size. You should also ensure that the filename does not contain any path traversal characters.`,
  parameters,
  toolResultPromptIntro: 'You have just written a text file to your internal scratch directory using the writeScratchFile tool.\n',
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const scratchDirectory = simpleExpandTilde(config.scratchDirectory);
    if (!fs.existsSync(scratchDirectory)) {
      fs.mkdirSync(scratchDirectory, { recursive: true });
    }
    const allowedFileTypes = config.allowedFileTypes;
    const maxFileSizeKB = config.maxFileSizeKB;
    const allowOverwrite = config.allowOverwrite;

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

    console.log(`Writing file: ${filename}`);
    fs.writeFileSync(filePath, contents);

    await freshenScratchFilesIndex(config);

    return `Written file ${filename}. ${contents.length} characters written.\nErrors: none.`;
  }
});

export default writeScratchFileTool;
