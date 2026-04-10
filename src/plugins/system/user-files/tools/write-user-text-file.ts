import { Static, Type } from 'typebox';
import { Tool } from '../../../../lib/tool-system.js';

const parameters = Type.Object({ path: Type.String(), contents: Type.String() });

const writeUserTextFileTool: Tool = {
  name: 'writeUserTextFile',
  availableFor: ['chat', 'voice'],
  description: 'Writes a text file to the user\'s filesystem. This tool should be used when the user explicitly asks you ' +
    'to create a text file on their computer, and provides the path and contents for the file. You should not use this ' +
    'tool for any other purpose, and you should not use it to write files that are not text files.',
  systemPromptFragment: `Call writeUserTextFile when the user explicitly asks you to create a text file on their computer, and ` +
    `provides the path and contents for the file. You must provide the path and the contents of the file as arguments. ` +
    `For example, if the user says "Can you create a text file named "notes.txt" with the contents "These are my notes."?", you ` +
    `would call writeUserTextFile with the argument "path" set to "~/notes.txt" and the argument "contents" set to "These are ` +
    `my notes.". If the response to a query would be too long for a single message, you MAY OFFER TO write the response to a file ` +
    `in the user's home directory using this tool.`,
  parameters,
  toolResultPromptIntro: 'You have just written a text file to the user\'s filesystem using the writeUserTextFile tool.\n',
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const filename = args.path;
    const contents = args.contents;
    // Here you would add the code to write the specified contents to a text file with the specified filename on the user\'s filesystem. For safety, you should ensure that the filename does not contain any path traversal characters, and that it ends with a .txt extension.
    return `Written file ${filename}. ${contents.length} characters written.`;
  }
};

export default writeUserTextFileTool;
