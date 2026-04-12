import { Tool } from '../../../../lib/tool-system.js';
import { Static, Type } from 'typebox';
import * as fs from 'fs';
import * as pathLib from 'path';

const parameters = Type.Object({
  path: Type.String(),
  filter: Type.Optional(Type.String()),
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

function matchesFilter(name: string, filter?: string): boolean {
  if (!filter) return true;

  const normalizedName = name.toLowerCase();
  const normalizedFilter = filter.toLowerCase();

  if (normalizedFilter.includes('*') || normalizedFilter.includes('?')) {
    const regexPattern = normalizedFilter
      .replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regexPattern}$`, 'i').test(name);
  }

  return normalizedName.includes(normalizedFilter);
}

const getDirectoryListingTool: (config: {
  allowedFilePaths?: string[];
}) => Tool = config => ({
  name: 'getDirectoryListing',
  availableFor: ['chat', 'voice', 'autonomy'],
  description: `
    Retrieves a list of files and folders in a specified directory on the user's computer. Has the guardrail that only allows the 
    listing of directories explicitly defined in the tool's config file.
  `,
  systemPromptFragment:
    `Call getDirectoryListing when the user asks you to show them the contents of a folder on their computer, ` +
    `or when they ask you to find a file without providing enough information to open it directly. Use the "path" argument to ` +
    `specify the directory you want to list, and optionally use the "filter" argument to specify a keyword or glob that should ` +
    `be used to filter the results. For example, if the user says "Can you show me the files in my Documents folder?", you might ` +
    `call getDirectoryListing with the "path" argument set to "~/Documents". If the user says "I can't find my resume, do you know ` +
    `where it is?", you might call getDirectoryListing with the "path" argument set to "~/" and the "filter" argument set to "resume"`,
  parameters,
  toolResultPromptIntro:
    'You have just received the results of a call to the getDirectoryListing tool. The results are in JSON format and have the following structure:\n' +
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
    const allowedFilePaths = config.allowedFilePaths || [];

    if (allowedFilePaths.length === 0) {
      return JSON.stringify({
        error:
          'No allowed file paths configured. Please configure allowedFilePaths in user-files plugin settings.',
      });
    }

    const absolutePath = expandAndResolvePath(path);
    if (!isAllowedPath(absolutePath, allowedFilePaths)) {
      return JSON.stringify({
        error: 'Access denied. Path is outside allowed file paths.',
      });
    }

    if (!fs.existsSync(absolutePath)) {
      return JSON.stringify({
        error: `Directory not found: ${path}`,
      });
    }

    const stats = fs.statSync(absolutePath);
    if (!stats.isDirectory()) {
      return JSON.stringify({
        error: `Path is not a directory: ${path}`,
      });
    }

    try {
      const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
      const items = entries
        .filter(entry => !entry.name.startsWith('.'))
        .filter(entry => matchesFilter(entry.name, filter))
        .map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'folder' : 'file',
        }))
        .sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

      return JSON.stringify({
        path,
        absolutePath,
        itemCount: items.length,
        items,
      });
    } catch (err) {
      return JSON.stringify({
        error: `Failed to list directory: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  },
});

export default getDirectoryListingTool;
