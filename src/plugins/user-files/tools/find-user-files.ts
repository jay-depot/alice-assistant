import { Static, Type } from 'typebox';
import { Tool } from '../../../lib/tool-system.js';
import { UserConfig } from '../../../lib/user-config.js';
import * as fs from 'fs';
import * as path from 'path';

const parameters = Type.Object({
  namePattern: Type.String({ description: 'Filename pattern to search for (supports * and ? wildcards)' }),
  extensions: Type.Optional(Type.Array(Type.String(), { description: 'File extensions to filter by (e.g. [".txt", ".pdf"])' })),
  containsText: Type.Optional(Type.String({ description: 'Optional text to search within filenames' })),
  modifiedAfter: Type.Optional(Type.String({ description: 'ISO 8601 date to find files modified after this date' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of results to return (default: 50)' }))
});

function matchesPattern(filename: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexPattern}$`, 'i').test(filename);
}

function searchDirectory(
  dir: string,
  namePattern: string,
  extensions: string[] | undefined,
  containsText: string | undefined,
  modifiedAfter: Date | undefined,
  results: Array<{ path: string; size: number; modified: string }>,
  limit: number
): void {
  if (results.length >= limit) return;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= limit) break;

      // Skip hidden files and common system directories
      if (entry.name.startsWith('.') || ['node_modules', '$RECYCLE.BIN', 'System Volume Information'].includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        searchDirectory(fullPath, namePattern, extensions, containsText, modifiedAfter, results, limit);
      } else if (entry.isFile()) {
        // Check name pattern
        if (!matchesPattern(entry.name, namePattern)) continue;

        // Check extensions
        if (extensions && extensions.length > 0) {
          const fileExt = path.extname(entry.name).toLowerCase();
          if (!extensions.includes(fileExt)) continue;
        }

        // Check text content in filename
        if (containsText && !entry.name.toLowerCase().includes(containsText.toLowerCase())) {
          continue;
        }

        // Check modified date
        if (modifiedAfter) {
          const stats = fs.statSync(fullPath);
          if (stats.mtime < modifiedAfter) continue;
        }

        const stats = fs.statSync(fullPath);
        results.push({
          path: fullPath,
          size: stats.size,
          modified: stats.mtime.toISOString()
        });
      }
    }
  } catch (err) {
    // Silently skip directories we can't read
    return;
  }
}

const findUserFilesTool: (config) => Tool = (config) => ({
  name: 'findUserFiles',
  availableFor: ['chat-session', 'voice-session', 'autonomy'],
  dependencies: [],
  description: `Recursively searches allowed directories for files matching a name pattern, with optional filters for ` +
    `file extensions, text content, and modification date.`,
  systemPromptFragment: `Call findUserFiles when the user asks you to find a file by name or pattern. You must provide ` +
    `the "namePattern" argument. You can optionally use "extensions" to filter by file type (e.g., [".txt", ".pdf"]), ` +
    `"containsText" to search for files containing specific text in the filename, "modifiedAfter" to find recently ` +
    `modified files (use ISO 8601 format like "2024-03-20"), and "limit" to control the maximum number of results ` +
    `(default is 50). For example, if the user says "find my resume", you might call findUserFiles with ` +
    `namePattern set to "*resume*" and extensions set to [".pdf", ".docx"]. The search is limited to user-configured ` +
    `allowed directories for security.`,
  callSignature: 'findUserFiles',
  parameters,
  toolResultPromptIntro: ``,
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const allowedRoots = config.allowedRoots || [];

    if (allowedRoots.length === 0) {
      return JSON.stringify({
        error: 'No search roots configured. Please configure allowedRoots in tool settings.',
        results: []
      });
    }

    const namePattern = args.namePattern;
    const extensions = args.extensions;
    const containsText = args.containsText;
    const modifiedAfter = args.modifiedAfter ? new Date(args.modifiedAfter) : undefined;
    const limit = args.limit || 50;

    if (limit > 500) {
      return JSON.stringify({
        error: 'Limit exceeds maximum allowed value of 500',
        results: []
      });
    }

    const results: Array<{ path: string; size: number; modified: string }> = [];

    for (const root of allowedRoots) {
      const expandedRoot = root.replace(/^~/, process.env.HOME || '/root');
      if (!fs.existsSync(expandedRoot)) continue;

      searchDirectory(expandedRoot, namePattern, extensions, containsText, modifiedAfter, results, limit);
    }

    return JSON.stringify({
      query: { namePattern, extensions, containsText, modifiedAfter: args.modifiedAfter, limit },
      resultCount: results.length,
      results: results.slice(0, limit)
    });
  }
});

export default findUserFilesTool;
