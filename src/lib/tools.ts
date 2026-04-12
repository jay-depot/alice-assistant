import { DynamicPromptConversationType } from '../lib.js';
import { Tool } from '../lib/tool-system.js';
import {
  hasConversationType,
  listConversationTypes,
} from './conversation-types.js';

const tools: Tool[] = [];

export function addTool(tool: Tool) {
  const unknownConversationType = tool.availableFor.find(
    conversationType => !hasConversationType(conversationType)
  );

  if (unknownConversationType) {
    throw new Error(
      `Tool ${tool.name} references unknown conversation type ${unknownConversationType}. Register that conversation type before registering the tool. Known conversation types are: ${listConversationTypes()
        .map(conversationType => conversationType.id)
        .join(', ')}.`
    );
  }

  tools.push(tool);
}

export function getTools(
  conversationType: DynamicPromptConversationType
): Tool[] {
  return tools.filter(tool => tool.availableFor.includes(conversationType));
}

export function hasTool(toolName: string): boolean {
  return tools.some(tool => tool.name === toolName);
}

export function addConversationTypeToTool(
  toolName: string,
  conversationType: DynamicPromptConversationType
): void {
  if (!hasConversationType(conversationType)) {
    throw new Error(
      `Cannot add unknown conversation type ${conversationType} to tool ${toolName}. Known conversation types are: ${listConversationTypes()
        .map(registeredConversationType => registeredConversationType.id)
        .join(', ')}.`
    );
  }

  const tool = tools.find(registeredTool => registeredTool.name === toolName);
  if (!tool) {
    throw new Error(
      `Cannot add conversation type ${conversationType} to unknown tool ${toolName}.`
    );
  }

  if (!tool.availableFor.includes(conversationType)) {
    tool.availableFor.push(conversationType);
  }
}
