import { Tool } from '../lib/tool-system.js';
import { Static, Type } from '@sinclair/typebox';

const parameters = Type.Object({ path: Type.String(), filter: Type.Optional(Type.String()) });

const getDirectoryListingTool: Tool = {
  name: 'getDirectoryListing',
  availableFor: ['chat-session', 'voice-session', 'autonomy'],
  description: `
    Retrieves a list of files and folders in a specified directory on the user's computer. Has the guardrail that only allows the 
    listing of directories explicitly defined in the tool's config file.
  `,
  systemPromptFragment: `Call getDirectoryListing when the user asks you to show them the contents of a folder on their computer, ` +
    `or when they ask you to find a file without providing enough information to open it directly. Use the "path" argument to ` +
    `specify the directory you want to list, and optionally use the "filter" argument to specify a keyword or glob that should ` +
    `be used to filter the results. For example, if the user says "Can you show me the files in my Documents folder?", you might ` +
    `call getDirectoryListing with the "path" argument set to "~/Documents". If the user says "I can't find my resume, do you know ` +
    `where it is?", you might call getDirectoryListing with the "path" argument set to "~/" and the "filter" argument set to "resume"`,
  callSignature: 'getDirectoryListing',
  parameters,
  toolResultPromptIntro: 'You have just received the results of a call to the getDirectoryListing tool. The results are in JSON format and have the following structure:\n' +
    '{\n' +
    '    "path": "The path that was listed",\n' +
    '    "items": [\n' +
    '        {\n' +
    '            "name": "Name of the file or folder",\n' +
    '            "type": "file or folder"\n' +
    '        },\n' +
    '        ...\n' +
    '    ]\n' +
    '}\n\n' +
    `The "path" field is a string representing the directory that was listed. The "items" field is an array of objects, each representing a file or folder in the listed directory. Each object has a "name" field, which is a string containing the name of the file or folder, and a "type" field, which is a string that is either "file" or "folder" indicating whether the item is a file or a folder. Use this information to answer the user's query, and remember that your response will be synthesized into speech, so keep it punchy and short.`,
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const path = args.path;
    const filter = args.filter;
    // Here you would add the code to list the contents of the specified directory on the user's computer, optionally filtering by the provided keyword, and return the results in the specified JSON format.
    // For the sake of this example, let's just return some dummy data.
    const dummyResult = {
      path,
      items: [
        { name: 'file1.txt', type: 'file' },
        { name: 'file2.txt', type: 'file' },
        { name: 'folder1', type: 'folder' },
        { name: 'folder2', type: 'folder' }
      ].filter(item => !filter || item.name.includes(filter))
    };
    return JSON.stringify(dummyResult);
  }
};

export default getDirectoryListingTool; 
