import path from 'node:path';
import {
  exists,
  readdir,
  readFile,
  stat,
  writeFile,
} from '../../../lib/node/fs-promised.js';
import { Conversation, Message } from '../../../lib/conversation.js';
import { ScratchFilesPluginConfigSchema } from './scratch-files.js';
import { simpleExpandTilde } from '../../../lib/simple-tilde-expansion.js';
import { createPluginLogger } from '../../../lib/plugin-logger.js';

const logger = createPluginLogger('scratch-files');

export async function freshenScratchFilesIndex(
  config: ScratchFilesPluginConfigSchema
) {
  const scratchDirectory = simpleExpandTilde(config.scratchDirectory);
  const indexFilePath = path.join(scratchDirectory, '.index');

  logger.log('Freshening scratch files index...');

  const indexLastModified = (await exists(indexFilePath))
    ? (await stat(indexFilePath)).mtime
    : null;
  const index = (await exists(indexFilePath))
    ? JSON.parse(await readFile(indexFilePath, 'utf-8'))
    : {};
  const files = await readdir(scratchDirectory);
  for (const file of files) {
    const isHidden = file.startsWith('.');
    const isAllowedType = config.allowedFileTypes.includes(
      path.extname(file).substring(1)
    );
    if (isHidden || !isAllowedType) {
      logger.log(
        `Skipping file ${file} (hidden: ${isHidden}, allowed type: ${isAllowedType})`
      );
      continue;
    }

    const filePath = path.join(scratchDirectory, file);
    const stats = await stat(filePath);
    if (stats.isFile()) {
      const lastModified = stats.mtime;
      if (
        !index[file] ||
        !indexLastModified ||
        lastModified > indexLastModified
      ) {
        logger.log(`Updating index for modified file: ${file}`);
        const content = await readFile(filePath, 'utf-8');
        const summary = await summarizeFileContent(file, content);
        index[file] = summary;
      }
    }
  }

  for (const indexedFile in index) {
    if (!files.includes(indexedFile)) {
      logger.log(`Removing deleted file from index: ${indexedFile}`);
      delete index[indexedFile];
    }
  }

  await writeFile(indexFilePath, JSON.stringify(index, null, 2), 'utf-8');
  logger.log('Scratch files index freshened.');
}

export async function reindexScratchFiles(
  config: ScratchFilesPluginConfigSchema
) {
  const scratchDirectory = simpleExpandTilde(config.scratchDirectory);
  const indexFilePath = path.join(scratchDirectory, '.index');
  const index: Record<string, string> = {};

  if (await exists(scratchDirectory)) {
    const files = await readdir(scratchDirectory);
    for (const file of files) {
      logger.log(`Processing scratch file: ${file}`);
      const isHidden = file.startsWith('.');
      const isAllowedType = config.allowedFileTypes.includes(
        path.extname(file).substring(1)
      );
      if (isHidden || !isAllowedType) {
        logger.log(
          `Skipping file ${file} (hidden: ${isHidden}, allowed type: ${isAllowedType})`
        );
        continue;
      }

      const filePath = path.join(scratchDirectory, file);
      const stats = await stat(filePath);
      if (stats.isFile()) {
        const content = await readFile(filePath, 'utf-8');
        const summary = await summarizeFileContent(file, content);
        index[file] = summary;
        logger.log(`Indexed file: ${file} - Summary: ${summary}`);
      }
    }
  }

  await writeFile(indexFilePath, JSON.stringify(index, null, 2), 'utf-8');
  logger.log('Scratch files indexing complete.');
}

function summarizeFileContent(file: string, content: string) {
  const summaryRequest: Message[] = [
    {
      role: 'system',
      content:
        'You are a helpful assistant that summarizes the content of files. ' +
        'Provide a concise summary that captures the main points and purpose of the ' +
        'file. Always respond in a single sentence of 15 words or fewer.',
    },
    {
      role: 'user',
      content: `Summarize the following file:\n\nFilename: ${file}\n==========\n${content}\n==========`,
    },
  ];

  return Conversation.sendDirectRequest(summaryRequest);
}
