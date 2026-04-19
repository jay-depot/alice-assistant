import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../../../../lib/tool-system.js';
import { Static, Type } from 'typebox';
import { simpleExpandTilde } from '../../../../lib/simple-tilde-expansion.js';
import { ScratchFilesPluginConfigSchema } from '../scratch-files.js';
import { freshenScratchFilesIndex } from '../scratch-files-index.js';
import { createPluginLogger } from '../../../../lib/plugin-logger.js';
import { resolveContents } from '../../../../lib/diff-resolver.js';

const logger = createPluginLogger('scratch-files');

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
  filename: Type.String({
    description:
      'The name of the file to write or update. Must be one of the allowed file types.',
  }),
  format: FormatSchema,
  contents: Type.String({
    description:
      'The new file contents (format=full) or a unified diff patch (format=diff).',
  }),
});

const updateScratchFileTool: (
  config: ScratchFilesPluginConfigSchema
) => Tool = config => ({
  name: 'updateScratchFile',
  availableFor: ['autonomy', 'chat', 'voice'],
  description:
    "Writes or updates a note in the assistant's internal scratch directory. " +
    'Supports two modes: full replacement (format=full) or targeted diff editing ' +
    '(format=diff). The diff mode takes a unified diff patch and applies it to the ' +
    'existing file contents.',
  systemPromptFragment:
    `Call updateScratchFile when you want to write or update a note in your internal scratch ` +
    `directory. Provide the filename, format (full or diff), and contents. Use format=full ` +
    `to replace the entire file, or format=diff to apply a unified diff patch to the existing ` +
    `file. You may only use the extensions [${config.allowedFileTypes.join(', ')}] for the ` +
    `filename, and the contents must not exceed ${config.maxFileSizeKB} KB in size. ` +
    `You should also ensure that the filename does not contain any path traversal characters.`,
  parameters,
  toolResultPromptIntro:
    'You have just updated a text file in your internal scratch directory using the updateScratchFile tool.\n',
  toolResultPromptOutro: '',
  execute: async (args: Static<typeof parameters>) => {
    const scratchDirectory = simpleExpandTilde(config.scratchDirectory);
    if (!fs.existsSync(scratchDirectory)) {
      fs.mkdirSync(scratchDirectory, { recursive: true });
    }
    const allowedFileTypes = config.allowedFileTypes;
    const maxFileSizeKB = config.maxFileSizeKB;
    const allowOverwrite = config.allowOverwrite;

    const filename = args.filename;
    const contents = args.contents;

    if (!allowedFileTypes.includes(filename.split('.').pop() || '')) {
      return `Error: File type not allowed.`;
    }

    if (contents.length > maxFileSizeKB * 1024) {
      return `Error: Content size exceeds the maximum allowed size of ${maxFileSizeKB} KB.`;
    }

    if (
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('..')
    ) {
      return `Error: Invalid filename. Path traversal characters are not allowed.`;
    }

    const filePath = path.join(scratchDirectory, filename);
    if (fs.existsSync(filePath) && !allowOverwrite) {
      return `Error: File already exists and overwriting is not allowed.`;
    }

    // Read existing contents (empty string if file doesn't exist)
    const original = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf-8')
      : '';

    // Resolve new contents via diff resolver
    const resolved = resolveContents(original, args.format, contents);
    if (resolved.ok === false) {
      const msg = `LLM provided an invalid diff patch: ${resolved.message}`;
      logger.warn(
        `updateScratchFile: ${msg} Tell the LLM to use format=full for this update.`
      );
      return `ERROR! UPDATE REJECTED.\n${msg}\nUse format=full to replace the entire file contents with your full replacement text, or re-read the file now to produce an accurate diff.`;
    }

    const newContents = resolved.contents;

    logger.log(`Updating file: ${filename} via ${args.format}`);
    fs.writeFileSync(filePath, newContents);

    await freshenScratchFilesIndex(config);

    const modeLabel = args.format === 'full' ? 'Written' : 'Updated';
    return `${modeLabel} file ${filename}. ${newContents.length} characters written.\nErrors: none.`;
  },
});

export default updateScratchFileTool;
