// Shared WebSocket message types for server-to-browser push communication.
// Imported by the web-ui server plugin (web-ui.ts) and the client-side hooks.
// No runtime imports — pure type declarations that compile away entirely.

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
  role: 'user' | 'assistant';
  messageKind: 'chat' | 'notification' | 'tool_call';
  content: string;
  timestamp: string;
  senderName?: string | null;
  toolCallData?: WsToolCallData;
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
  | { type: 'ping' };
