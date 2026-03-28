import { UserConfig } from '../lib/user-config.js';
import { Tool } from '../lib/tool-system.js';
import getNewsHeadlines from './get-news-headlines.js';
import manageRemindersTool from './manage-reminders.js';
import openApplicationTool from './open-application.js';
import systemHealthCheckTool from './system-health.js';
import writeUserTextFileTool from '../plugins/user-files/tools/write-user-text-file.js';

export function getTools() {
  const tools: Tool[] = [];
  const enabledTools = UserConfig.getConfig().enabledTools;

  if (enabledTools.getNewsHeadlines) {
    tools.push(getNewsHeadlines);
  }
  if (enabledTools.manageReminders) {
    tools.push(manageRemindersTool);
  }
  if (enabledTools.openApplication) {
    tools.push(openApplicationTool);
  }
  if (enabledTools.systemHealthCheck) {
    tools.push(systemHealthCheckTool);
  }
  if (enabledTools.writeUserTextFile) {
    tools.push(writeUserTextFileTool);
  }

  return tools;
}
