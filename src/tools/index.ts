import { UserConfig } from '../lib/user-config';
import { Tool } from '../lib/tool-system';
import deleteScratchFileTool from './delete-scratch-file';
import getDirectoryListingTool from './get-directory-listing';
import getNewsHeadlines from './get-news-headlines';
import listScratchFilesTool from './list-scratch-files';
import openApplicationTool from './open-application';
import previewUserTextFileTool from './preview-user-text-file';
import readScratchFileTool from './read-scratch-file';
import recallMemoryTool from './recall-memory';
import systemHealthCheckTool from './system-health';
import writeScratchFileTool from './write-scratch-file';
import writeUserTextFileTool from './write-user-text-file';

export function getTools() {
  const tools: Tool[] = [];
  const enabledTools = UserConfig.getConfig().enabledTools;

  if (enabledTools.deleteScratchFile) {
    tools.push(deleteScratchFileTool);
  }
  if (enabledTools.getDirectoryListing) {
    tools.push(getDirectoryListingTool);
  }
  if (enabledTools.getNewsHeadlines) {
    tools.push(getNewsHeadlines);
  }
  if (enabledTools.listScratchFiles) {
    tools.push(listScratchFilesTool);
  }
  if (enabledTools.openApplication) {
    tools.push(openApplicationTool);
  }
  if (enabledTools.previewUserTextFile) {
    tools.push(previewUserTextFileTool);
  }
  if (enabledTools.readScratchFile) {
    tools.push(readScratchFileTool);
  }
  if (enabledTools.recallMemory) {
    tools.push(recallMemoryTool);
  }
  if (enabledTools.systemHealthCheck) {
    tools.push(systemHealthCheckTool);
  }
  if (enabledTools.writeScratchFile) {
    tools.push(writeScratchFileTool);
  }
  if (enabledTools.writeUserTextFile) {
    tools.push(writeUserTextFileTool);
  }

  return tools;
}
