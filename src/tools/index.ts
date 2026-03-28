import { UserConfig } from '../lib/user-config.js';
import { Tool } from '../lib/tool-system.js';
import findUserFilesTool from './find-user-files.js';
import getDirectoryListingTool from './get-directory-listing.js';
import getNewsHeadlines from './get-news-headlines.js';
import manageRemindersTool from './manage-reminders.js';
import openApplicationTool from './open-application.js';
import previewUserTextFileTool from './preview-user-text-file.js';
import readUserTextFileTool from './read-user-text-file.js';
import systemHealthCheckTool from './system-health.js';
import writeUserTextFileTool from './write-user-text-file.js';

export function getTools() {
  const tools: Tool[] = [];
  const enabledTools = UserConfig.getConfig().enabledTools;

  if (enabledTools.findUserFiles) {
    tools.push(findUserFilesTool);
  }
  if (enabledTools.getDirectoryListing) {
    tools.push(getDirectoryListingTool);
  }
  if (enabledTools.getNewsHeadlines) {
    tools.push(getNewsHeadlines);
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
  if (enabledTools.readUserTextFile) {
    tools.push(readUserTextFileTool);
  }
  if (enabledTools.systemHealthCheck) {
    tools.push(systemHealthCheckTool);
  }
  if (enabledTools.writeUserTextFile) {
    tools.push(writeUserTextFileTool);
  }

  return tools;
}
