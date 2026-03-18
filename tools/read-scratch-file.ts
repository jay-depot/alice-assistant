import { Tool } from '../lib/tool-system';

const readScratchFileTool: Tool = {
  name: 'readScratchFile',
  dependencies: ['writeScratchFile', 'listScratchFiles'],
  description: 'Reads the contents of an internal text file. This is meant to read back the contents of files you\'ve written yourself, using the writeScratchFile tool.',
  systemPromptFragment: `Call readScratchFile when you want to read the contents of a text file that you have previously written using the writeScratchFile tool. The file must be located in your scratch directory, and you must provide the filename as an argument. For example, if you previously wrote a file named "notes.txt" using the writeScratchFile tool, you would call readScratchFile with the argument "filename" set to "notes.txt" to read its contents.`,
  callSignature: 'readScratchFile',
  toolResultPromptIntro: 'You have just read the contents of a text file using the readScratchFile tool.\n',
  toolResultPromptOutro: '',
  execute: async (args: Record<string, string>) => {
    const filename = args.filename;
    // Here you would add the code to read the contents of the specified file from the scratch directory and return it as a string.
    // For the sake of this example, let's just return a dummy string.
    return `Contents of file ${filename}\n== BEGIN FILE ==\nThis is the contents of the file ${filename}. In a real implementation, this would be the actual contents of the file that was read from the scratch directory.\n== END FILE ==`;
  }
};

export default readScratchFileTool;
