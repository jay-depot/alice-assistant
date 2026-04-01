import { DynamicPromptConversationType } from '../lib.js';
import { Tool } from '../lib/tool-system.js';

const tools: Tool[] = [];

export function addTool(tool: Tool) {
  tools.push(tool);
}

export function getTools(conversationType: DynamicPromptConversationType): Tool[] {
  return tools.filter(tool => tool.availableFor.includes(conversationType));
}
