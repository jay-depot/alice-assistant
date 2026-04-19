import * as fs from 'fs';
import * as pathLib from 'path';
import { Static, Type } from 'typebox';
import { Tool } from '../../../../lib/tool-system.js';
import { resolveContents } from '../../../../lib/diff-resolver.js';

const FormatSchema = Type.Union([
  Type.Literal('full', {
    description:
      'The contents are the complete new file contents. Use this when you want to replace the entire file.',
  }),
  Type.Literal('diff', {
    description:
      'The contents are a unified diff patch to apply to the existing file. Use this when you want to make targeted edits without re-sending the full content.',
  }),
]);

const parameters = Type.Object({
  path: Type.String({
    description: 'The path to the file to update.',
  }),
  format: FormatSchema,
  contents: Type.String({
    description:
      'The new file contents (format=full) or a unified diff patch (format=diff).',
  }),
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

const updateUserTextFileTool: (config: {
  allowedFilePaths?: string[];
  allowedFileTypesWrite?: string[];
  allowedUpdatePaths?: string[];
}) => Tool = config => ({
  name: 'updateUserTextFile',
  availableFor: ['chat', 'voice'],
  description:
    "Updates an existing text file in the user's filesystem. Prefer format=diff with a " +
    'unified diff patch for targeted edits — this avoids re-sending unchanged content. ' +
    'Use format=full only as a last resort. Read the file first with readUserTextFile to ' +
    'get the current content before producing a diff.',
  systemPromptFragment:
    `Call updateUserTextFile when the user wants to modify an existing text file on their ` +
    `computer. When updating a file, prefer format=diff with a unified diff patch for ` +
    `targeted edits. Read the file first with readUserTextFile to get the current content, ` +
    `then produce a diff. Use format=full only when a diff cannot be made to work after ` +
    `re-reading. If the response to a query would be too long for a single message, you MAY ` +
    `OFFER TO write the response to a file in the user's home directory using this tool.`,
  parameters,
  toolResultPromptIntro:
    "You have just updated a text file in the user's filesystem using the updateUserTextFile tool.\n",
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const filename = args.path;
    const contents = args.contents;

    const allowedFilePaths = config.allowedFilePaths || [];
    const allowedWriteExtensions = config.allowedFileTypesWrite || [];
    const allowedUpdatePaths = config.allowedUpdatePaths || [];

    if (allowedFilePaths.length === 0) {
      return JSON.stringify({
        error:
          'No allowed file paths configured. Please configure allowedFilePaths in user-files plugin settings.',
      });
    }

    const absolutePath = expandAndResolvePath(filename);

    // Check update-path restriction first (more specific than general write paths)
    if (allowedUpdatePaths.length > 0) {
      if (!isAllowedPath(absolutePath, allowedUpdatePaths)) {
        return JSON.stringify({
          error:
            'Access denied. Update path is outside allowed update paths. Use writeUserTextFile to create new files.',
        });
      }
    } else if (!isAllowedPath(absolutePath, allowedFilePaths)) {
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
          'Updating hidden files or files inside hidden directories is not allowed.',
      });
    }

    const extension = pathLib.extname(absolutePath).toLowerCase();
    if (
      allowedWriteExtensions.length > 0 &&
      !allowedWriteExtensions.includes(extension)
    ) {
      return JSON.stringify({
        error: `File type not allowed for updating. Allowed extensions: ${allowedWriteExtensions.join(', ')}`,
      });
    }

    // File must exist to update it
    if (!fs.existsSync(absolutePath)) {
      return JSON.stringify({
        error: `File ${filename} does not exist. Use writeUserTextFile to create new files.`,
      });
    }

    const original = fs.readFileSync(absolutePath, 'utf-8');

    const resolved = resolveContents(original, args.format, contents);
    if (resolved.ok === false) {
      return JSON.stringify({
        error: `ERROR! UPDATE REJECTED!\n${resolved.message}\nRe-read the file with readUserTextFile to get the current content, then produce a valid unified diff patch. Use format=full only as a last resort if you cannot produce a valid diff after re-reading.`,
      });
    }

    const newContents = resolved.contents;

    try {
      fs.writeFileSync(absolutePath, newContents, { encoding: 'utf-8' });
      return JSON.stringify({
        path: filename,
        absolutePath,
        charsWritten: newContents.length,
        bytesWritten: Buffer.byteLength(newContents, 'utf-8'),
        message: `Updated file ${filename}. ${newContents.length} characters written.`,
      });
    } catch (err) {
      return JSON.stringify({
        error: `Failed to update file: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  },
});

export default updateUserTextFileTool;
