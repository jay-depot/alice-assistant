// lib/serialization.ts — Pure serialization helpers for the web-ui plugin.
// Builds WsSession objects from ChatSession DB entities, and restores
// conversation message state from persisted rounds.

import { AgentSystem } from '../../../../lib/agent-system.js';
import type { Message } from '../../../../lib/conversation.js';
import type { ChatSession, ChatSessionRound } from '../db-schemas/index.js';
import type { WsSession, WsMessage, WsActiveAgent } from '../ws-types.js';

// ── Entity → wire-format conversion ──────────────────────────────────────

export function serializeRound(round: ChatSessionRound): {
  role: string;
  messageKind: string;
  content: string;
  reasoning: string | null;
  timestamp: string;
  senderName: string | null;
  toolCallData: unknown;
  toolName: string | null;
} {
  return {
    role: round.role,
    messageKind: round.messageKind,
    content: round.content,
    reasoning: round.reasoning,
    timestamp: round.timestamp.toISOString(),
    senderName: round.senderName,
    toolCallData: round.toolCallData,
    toolName: round.toolName,
  };
}

export function getActiveAgentsForSession(sessionId: number): WsActiveAgent[] {
  return AgentSystem.getInstancesBySession(sessionId).map(instance => ({
    instanceId: instance.instanceId,
    agentId: instance.agentId,
    agentName: instance.agentName,
    status: instance.status,
    startedAt:
      instance.startedAt instanceof Date
        ? instance.startedAt.toISOString()
        : String(instance.startedAt),
    pendingMessageCount: instance.pendingMessages.length,
  }));
}

export function buildWsSession(
  session: ChatSession,
  sessionId: number
): WsSession {
  return {
    id: sessionId,
    title: session.title,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    messages: session.rounds
      .getItems()
      .filter(round => round.role !== 'system' && round.role !== 'tool')
      .map(serializeRound) as WsMessage[],
    activeAgents: getActiveAgentsForSession(sessionId),
    hasCompactedContext:
      session.compactedContext != null &&
      session.compactedContext !== undefined,
  };
}

// ── Conversation message restoration ─────────────────────────────────────

/**
 * Rebuilds a Message[] array from persisted ChatSessionRound records,
 * skipping tool_call rounds (those are surfaced separately as tool batches).
 */
export function restoreConversationMessages(
  rounds: ChatSessionRound[]
): Message[] {
  return rounds
    .filter(round => round.messageKind !== 'tool_call')
    .map(round => ({
      role: round.role,
      content: round.content,
      reasoning: round.reasoning ?? undefined,
      ...(round.toolName ? { tool_name: round.toolName } : {}),
    }));
}

// ── Compacted context serialization ──────────────────────────────────────

/**
 * Serializes compacted context messages for database persistence.
 * Returns null for empty / undefined input so MikroORM stores a clean value.
 */
export function serializeCompactedContext(messages: Message[] | undefined):
  | {
      role: string;
      content: string;
      reasoning?: string;
      tool_name?: string;
    }[]
  | null {
  if (!messages || messages.length === 0) {
    return null;
  }
  return messages.map(m => ({
    role: m.role,
    content: m.content,
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    ...(m.tool_name ? { tool_name: m.tool_name } : {}),
  }));
}

/**
 * Restores compacted context from a JSON column value.
 * Handles both pre-parsed arrays (MikroORM p.json()) and legacy string values.
 * Returns undefined when the data is unusable (not an array, empty, or unparseable).
 */
export function restoreCompactedContext(json: unknown): Message[] | undefined {
  if (!json) {
    return undefined;
  }
  try {
    // MikroORM's p.json() column may return an already-parsed array
    // or a string (legacy). Handle both.
    const parsed = Array.isArray(json) ? json : JSON.parse(String(json));
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined;
    }
    return parsed as Message[];
  } catch {
    return undefined;
  }
}
