import { Static, Type } from '@sinclair/typebox';
import { Tool } from '../lib/tool-system';

const parameters = Type.Object({ path: Type.String() });

const previewUserTextFileTool: Tool = {
  name: 'previewUserTextFile',
  description: 'Reads the first 1kb of a text file on the user\'s filesystem and returns it as a string. You may use this tool when the user explicitly asks you to look at the file by name. You may also use this tool if the user has asked you to help them find a file on the computer, if you need to confirm you have found the correct file.',
  systemPromptFragment: `Call previewUserTextFile when the user explicitly asks you to look at the contents of a text file on ` +
    `their computer, or if the user has asked you to help them find a file on their computer and you want to confirm that you ` +
    `have found the correct file. You must provide the path as an argument. For example, if the user says "Can you show me ` +
    `the contents of notes.txt?", you would call previewUserTextFile with the argument "path" set to "~/notes.txt". If the user ` +
    `says "I want to find my resume file, but I'm not sure where it is. Can you look for it?", and you think you have found a ` +
    `file named "resume.txt", you might call previewUserTextFile with the argument "path" set to "resume.txt" to confirm that ` +
    `this file is indeed the user's resume.`,
  callSignature: 'previewUserTextFile',
  parameters,
  toolResultPromptIntro: 'You have just read the first 1kb of a text file on the user\'s filesystem using the previewUserTextFile tool. The contents of the preview begin below:\n',
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const filename = args.path;
    // Here you would add the code to read the first 1kb of the specified text file from the user's filesystem and return it as a string. For safety, you should ensure that the filename does not contain any path traversal characters, and that it ends with a .txt extension.
    return `Preview of file ${filename}\n== BEGIN FILE PREVIEW ==\nThis is a preview of the contents of the file ${filename}. In a real implementation, this would be the actual contents of the first 1kb of the specified file on the user's filesystem.\n== END FILE PREVIEW ==`;
  }
};

export default previewUserTextFileTool;
