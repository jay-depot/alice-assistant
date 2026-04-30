// Shared WebSocket message types for server-to-browser push communication.
// Imported by the web-ui server plugin (web-ui.ts) and the client-side hooks.
// No runtime imports — pure type declarations that compile away entirely.

// Minimal ToolCall shape mirroring Ollama’s interface so we can include it
// in stream_tool_calls without pulling in the full ollama package here.
export interface WsToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export type WsToolCallEventType =
  | 'assistant_turn_started'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_error';

export interface WsToolCallEvent {
  type: WsToolCallEventType;
  sessionId: number;
  callBatchId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  assistantContent?: string;
  resultSummary?: string;
  error?: string;
  requiresApproval?: boolean;
  taskAssistantId?: string;
  agentName?: string;
  agentInstanceId?: string;
  timestamp: string;
}

export interface WsToolCallData {
  callBatchId: string;
  toolName: string;
  status: 'running' | 'completed' | 'error';
  resultSummary?: string;
  error?: string;
  requiresApproval?: boolean;
  taskAssistantId?: string;
  agentName?: string;
}

export interface WsMessage {
  role: 'user' | 'assistant' | 'tool';
  messageKind: 'chat' | 'notification' | 'tool_call';
  content: string;
  reasoning?: string | null;
  timestamp: string;
  senderName?: string | null;
  toolCallData?: WsToolCallData;
  toolName?: string | null;
}

export interface WsActiveAgent {
  instanceId: string;
  agentId: string;
  agentName: string;
  status: 'running' | 'cancelled' | 'erroring' | 'completed';
  startedAt: string;
  pendingMessageCount: number;
}

export interface WsSession {
  id: number | string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: WsMessage[];
  activeAgents: WsActiveAgent[];
  /** True when the session has compacted context persisted in the database. */
  hasCompactedContext?: boolean;
}

export interface WsSessionSummary {
  id: number | string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
}

export type WsServerMessage =
  | { type: 'tool_call_event'; sessionId: number; event: WsToolCallEvent }
  | { type: 'session_updated'; sessionId: number; session: WsSession }
  | { type: 'sessions_list_updated'; sessions: WsSessionSummary[] }
  | { type: 'ping' }
  | { type: 'stream_thinking'; sessionId: number; delta: string }
  | { type: 'stream_content'; sessionId: number; delta: string }
  | { type: 'stream_tool_calls'; sessionId: number; toolCalls: WsToolCall[] }
  | {
      type: 'stream_done';
      sessionId: number;
      finalContent: string;
      finalReasoning: string | null;
    }
  | { type: 'stream_error'; sessionId: number; error: string }
  | {
      type: 'message_ack';
      sessionId: number;
      clientMessageKey: string;
    }
  | {
      type: 'message_error';
      sessionId: number;
      clientMessageKey: string;
      error: string;
    }
  | {
      type: 'stream_turn_complete';
      sessionId: number;
      turnIndex: number;
      hasToolCalls: boolean;
      /** UUID linking this turn boundary to the tool call batch that follows.
       *  Clients use this to interleave tool call indicators between turns. */
      callBatchId: string;
    }
  | { type: 'session_created'; session: WsSession }
  | { type: 'session_ended'; sessionId: number };

// ── Client → Server messages ────────────────────────────────────────────

export type WsClientMessage =
  | { type: 'pong' }
  | {
      type: 'send_message';
      sessionId: number;
      content: string;
      clientMessageKey: string;
    }
  | { type: 'create_session' }
  | { type: 'end_session'; sessionId: number };
