import type { LlmMessage, LlmToolCall } from '../llm-provider.js';

export type Message = LlmMessage;

export type ConversationStreamingCallbacks = {
  onThinking: (delta: string) => void;
  onContent: (delta: string) => void;
  onToolCalls: (toolCalls: LlmToolCall[]) => void;
  onError: (err: unknown) => void;
};

export type StartConversationOptions = {
  sessionId?: number;
  /** Set this when the conversation is for a task assistant. */
  taskAssistantId?: string;
  /** Set when the conversation belongs to a session-linked agent. */
  agentInstanceId?: string;
};
