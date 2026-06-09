import type { ToolCall } from 'ollama';

export type Message = {
  role: string;
  content: string;
  reasoning?: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
};

export type ConversationStreamingCallbacks = {
  onThinking: (delta: string) => void;
  onContent: (delta: string) => void;
  onToolCalls: (toolCalls: ToolCall[]) => void;
  onError: (err: unknown) => void;
};

export type StartConversationOptions = {
  sessionId?: number;
  /** Set this when the conversation is for a task assistant. */
  taskAssistantId?: string;
  /** Set when the conversation belongs to a session-linked agent. */
  agentInstanceId?: string;
};
