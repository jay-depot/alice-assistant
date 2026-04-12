import { Static, Type } from 'typebox';
import { Tool } from '../../../../lib/tool-system.js';
import * as fs from 'fs';
import * as pathLib from 'path';

const parameters = Type.Object({
  path: Type.String(),
  contents: Type.String(),
});

function expandAndResolvePath(inputPath: string): string {
  return pathLib.resolve(inputPath.replace(/^~/, process.env.HOME || '/root'));
}

function isAllowedPath(
  absolutePath: string,
  allowedFilePaths: string[]
): boolean {
  return allowedFilePaths.some(root => {
    const absoluteRoot = expandAndResolvePath(root);
    return (
      absolutePath === absoluteRoot ||
      absolutePath.startsWith(`${absoluteRoot}${pathLib.sep}`)
    );
  });
}

function pathContainsHiddenSegment(absolutePath: string): boolean {
  return absolutePath
    .split(pathLib.sep)
    .some(segment => segment.startsWith('.'));
}

const writeUserTextFileTool: (config: {
  allowedFilePaths?: string[];
  allowedFileTypesWrite?: string[];
}) => Tool = config => ({
  name: 'writeUserTextFile',
  availableFor: ['chat', 'voice'],
  description:
    "Writes a text file to the user's filesystem. This tool should be used when the user explicitly asks you " +
    'to create a text file on their computer, and provides the path and contents for the file. You should not use this ' +
    'tool for any other purpose, and you should not use it to write files that are not text files.',
  systemPromptFragment:
    `Call writeUserTextFile when the user explicitly asks you to create a text file on their computer, and ` +
    `provides the path and contents for the file. You must provide the path and the contents of the file as arguments. ` +
    `For example, if the user says "Can you create a text file named "notes.txt" with the contents "These are my notes."?", you ` +
    `would call writeUserTextFile with the argument "path" set to "~/notes.txt" and the argument "contents" set to "These are ` +
    `my notes.". If the response to a query would be too long for a single message, you MAY OFFER TO write the response to a file ` +
    `in the user's home directory using this tool.`,
  parameters,
  toolResultPromptIntro:
    "You have just written a text file to the user's filesystem using the writeUserTextFile tool.\n",
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const filename = args.path;
    const contents = args.contents;

    const allowedFilePaths = config.allowedFilePaths || [];
    const allowedWriteExtensions = config.allowedFileTypesWrite || [];

    if (allowedFilePaths.length === 0) {
      return JSON.stringify({
        error:
          'No allowed file paths configured. Please configure allowedFilePaths in user-files plugin settings.',
      });
    }

    const absolutePath = expandAndResolvePath(filename);

    if (!isAllowedPath(absolutePath, allowedFilePaths)) {
      return JSON.stringify({
        error: 'Access denied. Path is outside allowed file paths.',
      });
    }

    if (
      pathContainsHiddenSegment(
        pathLib.relative(pathLib.parse(absolutePath).root, absolutePath)
      )
    ) {
      return JSON.stringify({
        error:
          'Writing hidden files or files inside hidden directories is not allowed.',
      });
    }

    const extension = pathLib.extname(absolutePath).toLowerCase();
    if (
      allowedWriteExtensions.length > 0 &&
      !allowedWriteExtensions.includes(extension)
    ) {
      return JSON.stringify({
        error: `File type not allowed for writing. Allowed extensions: ${allowedWriteExtensions.join(', ')}`,
      });
    }

    const parentDir = pathLib.dirname(absolutePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    if (fs.existsSync(absolutePath) && !fs.statSync(absolutePath).isFile()) {
      return JSON.stringify({
        error: 'Target path exists and is not a regular file.',
      });
    }

    try {
      fs.writeFileSync(absolutePath, contents, { encoding: 'utf-8' });
      return JSON.stringify({
        path: filename,
        absolutePath,
        charsWritten: contents.length,
        bytesWritten: Buffer.byteLength(contents, 'utf-8'),
        message: `Written file ${filename}. ${contents.length} characters written.`,
      });
    } catch (err) {
      return JSON.stringify({
        error: `Failed to write file: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  },
});

export default writeUserTextFileTool;
