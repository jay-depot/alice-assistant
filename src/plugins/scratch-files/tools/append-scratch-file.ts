import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../../../lib/tool-system.js';
import { UserConfig } from '../../../lib/user-config.js';
import { Static, Type } from '@sinclair/typebox';
import { simpleExpandTilde } from '../../../lib/simple-tilde-expansion.js';

const parameters = Type.Object({ filename: Type.String(), contents: Type.String() });

UserConfig.load();

const appendScratchFileTool: Tool = {
  name: 'appendScratchFile',
  availableFor: ['autonomy', 'chat-session', 'voice-session'],
  dependencies: ['readScratchFile', 'listScratchFiles', 'writeScratchFile'],
  description: 'Allows the assistant to write notes for itself in an internal scratch directory. This is meant to be used in conjunction with the ' +
    'readScratchFile tool, which can read back the contents of files the assistant has written. The files the assistant writes with this tool ' +
    'will not be directly accessible to user, and are meant to be a place for the assistant to write "notes to itself" for later.',
  systemPromptFragment: `Call appendScratchFile when you want to add text to the end of a file in your internal scratch ` +
    `directory. These are notes you write to yourself, so there is no need to mention them to the user. Use ` +
    `this tool to store information that should be preserved between sessions. Do not use this tool to store ` +
    `interaction summaries. That is handled by other tools. Use this at your discretion to enhance your performance, ` +
    `for example by writing yourself notes about user preferences, frequent conversation topics, reminders ` +
    `for yourself or the user, exact quotes, precise interaction transcriptions, and notes to yourself for ` +
    `long-term planning or task management. You must provide the filename and the contents of the file as ` +
    `arguments. For example, if you add a reminder to the end of a file called "reminders.md", you would call ` +
    `appendScratchFile with the filename set to "reminders.txt" and the contents set to the text you want to add. ` +
    `You may only use the extensions ${UserConfig.getConfig().toolSettings.writeScratchFile.allowedFileTypes.join(', ')} for the ` +
    `filename, and the contents of the file must not exceed ${UserConfig.getConfig().toolSettings.writeScratchFile.maxFileSizeKB} ` +
    `KB in size. You should also ensure that the filename does not contain any path traversal characters.`,
  callSignature: 'appendScratchFile',
  parameters,
  toolResultPromptIntro: 'You have just updated a text file in your internal scratch directory using the appendScratchFile tool.\n',
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const scratchDirectory = simpleExpandTilde(UserConfig.getConfig().toolSettings.writeScratchFile.scratchDirectory);
    if (!fs.existsSync(scratchDirectory)) {
      fs.mkdirSync(scratchDirectory, { recursive: true });
    }
    const allowedFileTypes = UserConfig.getConfig().toolSettings.writeScratchFile.allowedFileTypes;
    const maxFileSizeKB = UserConfig.getConfig().toolSettings.writeScratchFile.maxFileSizeKB;
    const allowOverwrite = UserConfig.getConfig().toolSettings.writeScratchFile.allowOverwrite;

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
    if (fs.existsSync(filePath)) {
      const existingContents = fs.readFileSync(filePath, 'utf-8');

      if (existingContents.length + contents.length > maxFileSizeKB * 1024) {
        return `Error: Appending this content would cause the file size to exceed the maximum allowed size of ` +
          `${maxFileSizeKB} KB. Current file size is ${existingContents.length} bytes, new content size is ` +
          `${contents.length} bytes, maximum allowed size is ${maxFileSizeKB * 1024} bytes.\n` +
          `Consider writing the content to a new file instead, or reducing the size of the ` +
          `content you are trying to append. You can also try reading the existing contents of ` +
          `the file using the readScratchFile tool, combine that with the content you want to ` +
          `append, and then add using the combined contents to produce a smaller output overwrite ` +
          `the existing file with that content using the writeScratchFile tool.`;
      }

      fs.writeFileSync(filePath, existingContents + '\n' + contents);
    } else {
      fs.writeFileSync(filePath, contents);
    }

    return `Updated file ${filename}. ${contents.length} characters appended.\nErrors: none.`;
  }
};

export default appendScratchFileTool;
