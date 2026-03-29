import { Tool } from '../lib/tool-system.js';

const tools: Tool[] = [];

export function addTool(tool: Tool) {
  tools.push(tool);
}

export function getTools() {
  return tools;
}
