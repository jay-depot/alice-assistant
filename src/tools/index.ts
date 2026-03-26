import { UserConfig } from '../lib/user-config.js';
import { Tool } from '../lib/tool-system.js';
import appendScratchFileTool from './append-scratch-file.js';
import deleteScratchFileTool from './delete-scratch-file.js';
import findUserFilesTool from './find-user-files.js';
import getDirectoryListingTool from './get-directory-listing.js';
import getNewsHeadlines from './get-news-headlines.js';
import listScratchFilesTool from './list-scratch-files.js';
import manageRemindersTool from './manage-reminders.js';
import openApplicationTool from './open-application.js';
import previewUserTextFileTool from './preview-user-text-file.js';
import readScratchFileTool from './read-scratch-file.js';
import readUserTextFileTool from './read-user-text-file.js';
import systemHealthCheckTool from './system-health.js';
import writeScratchFileTool from './write-scratch-file.js';
import writeUserTextFileTool from './write-user-text-file.js';

export function getTools() {
  const tools: Tool[] = [];
  const enabledTools = UserConfig.getConfig().enabledTools;

  if (enabledTools.appendScratchFile) {
    tools.push(appendScratchFileTool);
  }
  if (enabledTools.deleteScratchFile) {
    tools.push(deleteScratchFileTool);
  }
  if (enabledTools.findUserFiles) {
    tools.push(findUserFilesTool);
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
  if (enabledTools.manageReminders) {
    tools.push(manageRemindersTool);
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
  if (enabledTools.readUserTextFile) {
    tools.push(readUserTextFileTool);
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
