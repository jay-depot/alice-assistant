import { Static, Type } from 'typebox';
import { Tool } from '../../../../lib/tool-system.js';
import * as fs from 'fs';
import * as path from 'path';

const parameters = Type.Object({
  path: Type.String({ description: 'Path to the text file to read' }),
  offset: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: 'Byte offset to start reading from (default: 0)',
    })
  ),
  maxBytes: Type.Optional(
    Type.Number({
      description: 'Maximum bytes to read (default: 65536, max: 1048576)',
    })
  ),
  encoding: Type.Optional(
    Type.String({ description: 'File encoding (default: utf-8)' })
  ),
});

function isAllowedPath(filePath: string, allowedFilePaths: string[]): boolean {
  // Expand tilde
  const expandedPath = filePath.replace(/^~/, process.env.HOME || '/root');
  const absolutePath = path.resolve(expandedPath);

  // Check if path is within allowed roots
  for (const root of allowedFilePaths) {
    const expandedRoot = root.replace(/^~/, process.env.HOME || '/root');
    const absoluteRoot = path.resolve(expandedRoot);
    if (absolutePath.startsWith(absoluteRoot)) {
      return true;
    }
  }

  return false;
}

function isAllowedExtension(
  filePath: string,
  allowedExtensions: string[]
): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (allowedExtensions.length === 0) {
    return true; // All extensions allowed if not specified
  }
  return allowedExtensions.includes(ext);
}

const readUserTextFileTool: (config) => Tool = config => ({
  name: 'readUserTextFile',
  availableFor: ['chat', 'voice', 'autonomy'],
  description:
    `Reads the contents of a text file from the user's filesystem in chunks, with optional offset and size limits.`,
  systemPromptFragment:
    `Call readUserTextFile when the user asks you to read the full contents of a text file, summarize ` +
    `a document, or extract information from it. Provide the "path" argument with the file to read. Optionally use "maxBytes" ` +
    `to limit the amount read (default 65KB, max 1MB), "offset" to start reading from a specific byte position, and "encoding" ` +
    `to specify the character encoding. For example, if the user says "summarize my notes from last week", you might call ` +
    `readUserTextFile with path set to the file path and maxBytes set to an appropriate size. The tool respects security ` +
    `constraints on which directories and file types you can access.`,
  parameters,
  toolResultPromptIntro:
    `You have just read the contents of a text file using the readUserTextFile tool. The file contents ` +
    `are provided below (may be truncated if larger than the requested byte limit). Use this information to answer the user's ` +
    `question, summarize the content, or extract relevant information.`,
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const allowedFilePaths = config.allowedFilePaths || [];
    const allowedExtensions = config.allowedExtensions || [
      '.txt',
      '.md',
      '.csv',
      '.json',
      '.log',
    ];

    if (allowedFilePaths.length === 0) {
      return JSON.stringify({
        error:
          'No allowed root directories configured for readUserTextFile tool. Configure allowedFilePaths in tool settings.',
      });
    }

    const filePath = args.path;
    const offset = args.offset ?? 0;
    const maxBytes = Math.min(args.maxBytes || 65536, 1048576); // Cap at 1MB

    if (!Number.isInteger(offset) || offset < 0) {
      return JSON.stringify({
        error: 'Offset must be a non-negative integer.',
      });
    }

    // Security checks
    if (!isAllowedPath(filePath, allowedFilePaths)) {
      return JSON.stringify({
        error: `Access denied. Path is outside allowed root directories.`,
      });
    }

    if (!isAllowedExtension(filePath, allowedExtensions)) {
      return JSON.stringify({
        error: `File type not allowed. Allowed extensions: ${allowedExtensions.join(', ')}`,
      });
    }

    const expandedPath = filePath.replace(/^~/, process.env.HOME || '/root');
    const absolutePath = path.resolve(expandedPath);

    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      return JSON.stringify({
        error: `File not found: ${filePath}`,
      });
    }

    // Check if it's a regular file
    const stats = fs.statSync(absolutePath);
    if (!stats.isFile()) {
      return JSON.stringify({
        error: `Path is not a regular file: ${filePath}`,
      });
    }

    // Check file size limits
    const maxAllowedSize = config.maxFileSizeBytes || 10485760; // 10MB default
    if (stats.size > maxAllowedSize) {
      return JSON.stringify({
        error: `File exceeds maximum allowed size of ${maxAllowedSize} bytes.`,
        fileSize: stats.size,
      });
    }

    if (offset > stats.size) {
      return JSON.stringify({
        error: `Offset ${offset} is beyond end of file (${stats.size} bytes).`,
        fileSize: stats.size,
      });
    }

    try {
      // Read the file
      const fileContent = fs.readFileSync(absolutePath);

      // Apply offset and maxBytes truncation
      const truncated = fileContent.subarray(offset, offset + maxBytes);
      const wasComplete = truncated.length === fileContent.length - offset;

      return JSON.stringify({
        path: filePath,
        size: stats.size,
        offset,
        bytesRead: truncated.length,
        isComplete: wasComplete,
        content: truncated,
        message: wasComplete
          ? 'Complete file contents'
          : 'Partial contents (truncated)',
      });
    } catch (err) {
      return `Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }
  },
});

export default readUserTextFileTool;
