/**
 * Shared types for the A.L.I.C.E. TUI client.
 *
 * These types mirror the WebSocket message types from the web-ui plugin
 * (ws-types.ts) but are duplicated here so the TUI can be compiled and run
 * as a separate process without importing from a plugin path.
 */

// ── WebSocket message types ──────────────────────────────────────────────

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
  | { type: 'ping' };

// ── REST API response types ──────────────────────────────────────────────

export interface ApiSession {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: WsMessage[];
  activeAgents: WsActiveAgent[];
  hasCompactedContext?: boolean;
}

export interface ApiSessionSummary {
  id: number;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
}

export interface ApiCompactResponse {
  sessionId: number;
  compacted: boolean;
  mode: string;
}

// ── TUI-internal types ──────────────────────────────────────────────────

export interface TuiConfig {
  host: string;
  port: number;
  plain: boolean;
}

/** A tool call batch grouped by callBatchId for display. */
export interface TuiToolCallBatch {
  callBatchId: string;
  calls: TuiToolCallEntry[];
  status: 'running' | 'completed' | 'error';
  agentName?: string;
}

export interface TuiToolCallEntry {
  toolName: string;
  status: 'running' | 'completed' | 'error';
  resultSummary?: string;
  error?: string;
}

/** Events emitted by the WS client for the UI layer. */
export type TuiWsEvent =
  | { type: 'session_updated'; session: WsSession }
  | { type: 'tool_call_event'; event: WsToolCallEvent }
  | { type: 'sessions_list_updated'; sessions: WsSessionSummary[] }
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'reconnecting'; attempt: number };

/** Interface that both blessed and readline UIs implement. */
export interface TuiFrontend {
  start(): Promise<void>;
  stop(): Promise<void>;
  onUserInput: ((text: string) => void) | null;
}
