import { TSchema } from 'typebox';
import { getTools } from './tools.js';
import { DynamicPromptConversationType } from './dynamic-prompt.js';
import { ConversationTypeId } from './conversation-types.js';

type ToolPromptFragmentFunction =
  | string
  | ((type: DynamicPromptConversationType) => string);

type OllamaRequestToolsPropItem = {
  type: 'function';
  function: {
    name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Temporary until typebox is added
    parameters: Record<string, any>; // TODO Since this is a JSON schema, we may as well use typebox to generate them easily
    description: string;
  };
};

export type ToolExecutionContext = {
  toolName: string;
  conversationType: DynamicPromptConversationType;
  sessionId?: number;
  /** Set when the tool is being called within a task assistant conversation. */
  taskAssistantId?: string;
  /** Set when the tool is being called within a session-linked agent conversation. */
  agentInstanceId?: string;
};

export type Tool = {
  name: string;
  availableFor: ConversationTypeId[];
  description: string;
  systemPromptFragment: ToolPromptFragmentFunction;
  parameters: TSchema;
  toolResultPromptIntro: ToolPromptFragmentFunction;
  toolResultPromptOutro: ToolPromptFragmentFunction;
  execute: (
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ) => Promise<string>;
};

export function buildOllamaToolDescriptionObject(
  conversationType: DynamicPromptConversationType
): OllamaRequestToolsPropItem[] {
  const tools = getTools(conversationType);
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      parameters: tool.parameters,
      description: tool.description,
    },
  }));
}
