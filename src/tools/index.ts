import { UserConfig } from '../lib/user-config.js';
import { Tool } from '../lib/tool-system.js';

export function getTools() {
  const tools: Tool[] = [];
  const enabledTools = UserConfig.getConfig().enabledTools;

  return tools;
}
