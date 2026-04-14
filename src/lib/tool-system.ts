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

export type ToolSecurityTaintStatus = 'tainted' | 'clean' | 'secure';

export type Tool = {
  name: string;
  availableFor: ConversationTypeId[];
  description: string;
  systemPromptFragment: ToolPromptFragmentFunction;
  parameters: TSchema;
  toolResultPromptIntro: ToolPromptFragmentFunction;
  toolResultPromptOutro: ToolPromptFragmentFunction;
  /**
   * Defaults to clean if not provided. Tainted tools taint the conversation context
   * and prevent secure tools from running. Secure tools can only run in
   * conversations with no tainted tools in their history. This is primarily used
   * to provide otherwise unsafe tools (like home automation with no confirmations)
   * for voice control. Web/TUI interactions should avoid using secure tools at all,
   * and instead rely on "clean" tools that require explicit user confirmation for
   * sensitive actions.
   * Clean tools should only return data that will not contain potential
   * prompt-injection vectors. This does not depend on format, but source. For
   * example, a web page fetch tool, that can access any web page on the internet should be
   * tainted, but a tool that reads from the API of a verified. trustworthy provider can be
   * marked clean. Social media content is *always* tainted.
   */

  taintStatus?: ToolSecurityTaintStatus;
  execute: (
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ) => Promise<string>;
  /** If true, this tool requires user approval before execution. Not enforced yet — flag only. */
  requiresApproval?: boolean;
};

// ---------------------------------------------------------------------------
// Tool Call Events
// ---------------------------------------------------------------------------

type ToolCallEventBase = {
  conversationType: ConversationTypeId;
  sessionId?: number;
  taskAssistantId?: string;
  agentInstanceId?: string;
  timestamp: string; // ISO 8601
};

type ToolCallProgressEvent = ToolCallEventBase & {
  type: 'tool_call_started' | 'tool_call_completed' | 'tool_call_error';
  /** UUID — groups tool calls from the same Promise.all batch. */
  callBatchId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  /** Populated on completed/error: truncated result summary (first ~200 chars). */
  resultSummary?: string;
  /** Populated on error. */
  error?: string;
  /** Whether this tool requires approval (mirrors the Tool flag). */
  requiresApproval?: boolean;
};

type AssistantTurnStartedEvent = ToolCallEventBase & {
  type: 'assistant_turn_started';
  assistantContent: string;
};

export type ToolCallEvent = ToolCallProgressEvent | AssistantTurnStartedEvent;

type ToolCallEventCallback = (event: ToolCallEvent) => Promise<void>;

const toolCallEventCallbacks: ToolCallEventCallback[] = [];

export const ToolCallEvents = {
  onToolCallEvent(callback: ToolCallEventCallback): void {
    toolCallEventCallbacks.push(callback);
  },
  async dispatchToolCallEvent(event: ToolCallEvent): Promise<void> {
    await Promise.all(toolCallEventCallbacks.map(callback => callback(event)));
  },
};

export function buildOllamaToolDescriptionObject(
  conversationType: DynamicPromptConversationType,
  isConversationTainted = false
): OllamaRequestToolsPropItem[] {
  const tools = getTools(conversationType);
  return tools
    .filter(tool => {
      // Secure tools must not be offered to the LLM when the conversation is tainted.
      const effectiveTaint = tool.taintStatus ?? 'clean';
      return !(isConversationTainted && effectiveTaint === 'secure');
    })
    .map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        parameters: tool.parameters,
        description: tool.description,
      },
    }));
}
