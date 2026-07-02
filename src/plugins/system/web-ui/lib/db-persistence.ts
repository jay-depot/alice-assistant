// lib/db-persistence.ts — Database persistence helpers for the web-ui plugin.
// Pure persistence functions only — session lifecycle orchestration lives
// in session-manager.ts.

import { ChatSession, ChatSessionRound } from '../db-schemas/index.js';
import { serializeCompactedContext } from './serialization.js';
import type { WebUiContext } from '../context.js';
import type { Conversation } from '../../../../lib/conversation.js';
import type { EntityManager } from '@mikro-orm/sqlite';

/** Persists unsynchronized conversation messages into the database.
 *  Tool-call rows are flushed by explicit orchestration points in callers
 *  (e.g. after executeToolCalls) so ordering stays deterministic by turn.
 */
export async function persistUnsynchronizedMessages(
  ctx: WebUiContext,
  em: EntityManager,
  session: ChatSession,
  conversation: Conversation,
  assistantMessageKind: 'chat' | 'notification' = 'chat',
  senderName?: string
): Promise<void> {
  const unsynchronizedMessages = conversation.getUnsynchronizedMessages();
  const persistableMessages = unsynchronizedMessages.filter(
    message => message.role !== 'system'
  );

  if (persistableMessages.length === 0) {
    if (unsynchronizedMessages.length > 0) {
      conversation.markUnsynchronizedMessagesSynchronized();
    }
    return;
  }

  persistableMessages.forEach(message => {
    const round = em.create(ChatSessionRound, {
      chatSession: session,
      role: message.role as 'user' | 'assistant' | 'system' | 'tool',
      messageKind: message.role === 'assistant' ? assistantMessageKind : 'chat',
      timestamp: new Date(),
      content: message.content,
      attachments: message.images ?? null,
      reasoning: message.reasoning ?? null,
      senderName: message.role === 'assistant' ? (senderName ?? null) : null,
      toolName: message.tool_name ?? null,
    });

    session.rounds.add(round);
    session.updatedAt = round.timestamp;

  });

  await em.flush();
  conversation.markUnsynchronizedMessagesSynchronized();

  // Persist the compacted context so sessions can be restored with their
  // compaction state intact — avoids re-compacting from scratch on reload.
  // MikroORM's p.json() produces a Brand type; cast through unknown.
  (
    session as unknown as {
      compactedContext:
        | { role: string; content: string; tool_name?: string }[]
        | null;
    }
  ).compactedContext = serializeCompactedContext(conversation.compactedContext);
  await em.flush();
}

/** Flush buffered tool call rounds into the DB before conversation messages so
 *  tool calls appear before the final assistant response in the persisted order. */
export function flushPendingToolCallRounds(
  ctx: WebUiContext,
  em: EntityManager,
  session: ChatSession
): void {
  const pending = ctx.pendingToolCallRounds.get(session.id);
  if (!pending || pending.length === 0) {
    return;
  }
  ctx.pendingToolCallRounds.delete(session.id);

  for (const entry of pending) {
    const round = em.create(ChatSessionRound, {
      chatSession: session,
      ...entry,
    });
    session.rounds.add(round);
    session.updatedAt = round.timestamp;
  }
}

/** Flush only pending tool-call rows for a specific call batch id.
 *  Leaves rows from other batches queued for their own turn boundary.
 */
export function flushPendingToolCallRoundsForBatch(
  ctx: WebUiContext,
  em: EntityManager,
  session: ChatSession,
  callBatchId: string
): void {
  const pending = ctx.pendingToolCallRounds.get(session.id);
  if (!pending || pending.length === 0) {
    return;
  }

  const matching: typeof pending = [];
  const remaining: typeof pending = [];

  for (const entry of pending) {
    if (entry.toolCallData.callBatchId === callBatchId) {
      matching.push(entry);
    } else {
      remaining.push(entry);
    }
  }

  if (matching.length === 0) {
    return;
  }

  if (remaining.length > 0) {
    ctx.pendingToolCallRounds.set(session.id, remaining);
  } else {
    ctx.pendingToolCallRounds.delete(session.id);
  }

  for (const entry of matching) {
    const round = em.create(ChatSessionRound, {
      chatSession: session,
      ...entry,
    });
    session.rounds.add(round);
    session.updatedAt = round.timestamp;
  }
}

/** Flushes any unsynchronized messages from a cached conversation to the
 *  database. Returns true if a conversation was found and flushed.
 *  `evictConversation` is a callback that removes the session from
 *  the cache — the callers in session-manager.ts pass evictCachedConversation. */
export async function flushCachedConversation(
  ctx: WebUiContext,
  sessionId: number,
  evictConversation: (sid: number) => void,
  assistantMessageKind: 'chat' | 'notification' = 'chat'
): Promise<boolean> {
  const conversation = ctx.cachedChatConversations.get(sessionId);
  if (!conversation) {
    return false;
  }

  const orm = await ctx.onDatabaseReady(async databaseOrm => databaseOrm);
  const em = orm.em.fork();
  const session = await em.findOne(
    ChatSession,
    { id: sessionId },
    { populate: ['rounds'] }
  );
  if (!session) {
    evictConversation(sessionId);
    return false;
  }

  await persistUnsynchronizedMessages(
    ctx,
    em,
    session,
    conversation,
    assistantMessageKind
  );
  return true;
}
