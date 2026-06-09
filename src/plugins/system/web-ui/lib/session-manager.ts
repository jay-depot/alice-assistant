// lib/session-manager.ts — Session lifecycle management for the web-ui plugin.
// Owns conversation caching, session operation serialization, and the
// create/delete/flush lifecycle.

import { startConversation, PluginHookInvocations } from '../../../../lib.js';
import { ChatSession } from '../db-schemas/index.js';
import {
  persistUnsynchronizedMessages,
  flushPendingToolCallRounds,
  flushCachedConversation,
} from './db-persistence.js';
import {
  restoreConversationMessages,
  restoreCompactedContext,
  buildWsSession,
} from './serialization.js';
import type { WebUiContext } from '../context.js';
import type { Conversation } from '../../../../lib/conversation.js';

// ── Cache helpers ────────────────────────────────────────────────────────

export function evictCachedConversation(
  ctx: WebUiContext,
  sessionId: number
): void {
  ctx.cachedChatConversations.delete(sessionId);
}

export function getOrCreateCachedConversation(
  ctx: WebUiContext,
  session: ChatSession
): Conversation {
  const cachedConversation = ctx.cachedChatConversations.get(session.id);
  if (cachedConversation) {
    return cachedConversation;
  }

  const conversation = startConversation('chat', { sessionId: session.id });
  conversation.restoreContext(
    restoreConversationMessages(session.rounds.getItems()),
    restoreCompactedContext(session.compactedContext)
  );
  ctx.cachedChatConversations.set(session.id, conversation);
  return conversation;
}

// ── Session operation queue ──────────────────────────────────────────────
// Serialises mutations per session so concurrent requests (e.g. from WS
// and agent callbacks) don't race on the same ChatSession entity.

export async function runSessionOperation<T>(
  ctx: WebUiContext,
  sessionId: number,
  operation: () => Promise<T>
): Promise<T> {
  const previousOperation =
    ctx.sessionOperationQueues.get(sessionId) ?? Promise.resolve();
  let releaseQueue: () => void;
  const queueSlot = new Promise<void>(resolve => {
    releaseQueue = resolve;
  });

  const queuedOperation = previousOperation
    .catch(() => undefined)
    .then(() => queueSlot);

  ctx.sessionOperationQueues.set(sessionId, queuedOperation);

  await previousOperation.catch(() => undefined);

  try {
    return await operation();
  } finally {
    releaseQueue!();
    if (ctx.sessionOperationQueues.get(sessionId) === queuedOperation) {
      ctx.sessionOperationQueues.delete(sessionId);
    }
  }
}

// ── Session lifecycle ────────────────────────────────────────────────────

export async function createEmptyChatSession(
  ctx: WebUiContext,
  title?: string
): Promise<number> {
  const orm = await ctx.onDatabaseReady(async databaseOrm => databaseOrm);
  const em = orm.em.fork();
  const createdAt = new Date();
  const conversationRecord = em.create(ChatSession, {
    title: title || 'New Conversation',
    rounds: [],
    createdAt,
    updatedAt: createdAt,
  });
  await em.flush();

  const conversation = startConversation('chat', {
    sessionId: conversationRecord.id,
  });
  ctx.cachedChatConversations.set(conversationRecord.id, conversation);

  return conversationRecord.id;
}

export async function closeAndEvictCachedConversation(
  ctx: WebUiContext,
  sessionId: number
): Promise<void> {
  const conversation = ctx.cachedChatConversations.get(sessionId);
  if (!conversation) {
    return;
  }

  await flushCachedConversation(ctx, sessionId, sid =>
    evictCachedConversation(ctx, sid)
  );
  await PluginHookInvocations.invokeOnUserConversationWillEnd(
    conversation,
    'chat'
  );
  await conversation.closeConversation();
  evictCachedConversation(ctx, sessionId);
}

export async function flushAndEvictAllCachedConversations(
  ctx: WebUiContext
): Promise<void> {
  const cachedSessionIds = [...ctx.cachedChatConversations.keys()];
  for (const sessionId of cachedSessionIds) {
    await flushCachedConversation(ctx, sessionId, sid =>
      evictCachedConversation(ctx, sid)
    );
    evictCachedConversation(ctx, sessionId);
  }
}

// ── Target session resolution ────────────────────────────────────────────

export async function resolveTargetChatSession(
  ctx: WebUiContext,
  options: {
    title?: string;
    openNewChatIfNone?: boolean;
    alwaysOpenNewChat?: boolean;
  }
): Promise<number | null> {
  if (options.alwaysOpenNewChat) {
    return createEmptyChatSession(ctx, options.title);
  }

  const orm = await ctx.onDatabaseReady(async databaseOrm => databaseOrm);
  const sessionLookupEm = orm.em.fork();
  const mostRecentSession = await sessionLookupEm.findOne(
    ChatSession,
    {},
    {
      orderBy: { updatedAt: 'DESC', id: 'DESC' },
    }
  );

  if (!mostRecentSession) {
    if (!options.openNewChatIfNone) {
      return null;
    }

    return createEmptyChatSession(ctx, options.title);
  }

  return mostRecentSession.id;
}

// ── Assistant message queuing ────────────────────────────────────────────

export async function queueAssistantMessageToSession(
  ctx: WebUiContext,
  sessionId: number,
  message: {
    content: string;
    messageKind?: 'chat' | 'notification';
    senderName?: string;
  }
): Promise<void> {
  await runSessionOperation(ctx, sessionId, async () => {
    const orm = await ctx.onDatabaseReady(async databaseOrm => databaseOrm);
    const em = orm.em.fork();
    const session = await em.findOne(
      ChatSession,
      { id: sessionId },
      { populate: ['rounds'] }
    );
    if (!session) {
      throw new Error(
        `Chat session ${sessionId} disappeared before assistant message delivery.`
      );
    }

    const conversation = getOrCreateCachedConversation(ctx, session);
    // Flush any buffered agent tool call rounds before the agent's message so
    // they are persisted with lower DB IDs (i.e. appear above it in the chat).
    flushPendingToolCallRounds(ctx, em, session);
    await conversation.appendExternalMessage({
      role: 'assistant',
      content: message.content,
    });
    await persistUnsynchronizedMessages(
      ctx,
      em,
      session,
      conversation,
      message.messageKind || 'chat',
      message.senderName
    );
    ctx.broadcastWs({
      type: 'session_updated',
      sessionId: session.id,
      session: buildWsSession(session, session.id),
    });
  });
}

export async function queueAssistantMessage(
  ctx: WebUiContext,
  message: {
    content: string;
    title?: string;
    messageKind?: 'chat' | 'notification';
    openNewChatIfNone?: boolean;
    alwaysOpenNewChat?: boolean;
  }
): Promise<number | null> {
  const sessionId = await resolveTargetChatSession(ctx, {
    title: message.title,
    openNewChatIfNone: message.openNewChatIfNone,
    alwaysOpenNewChat: message.alwaysOpenNewChat,
  });

  if (sessionId === null) {
    return null;
  }

  await queueAssistantMessageToSession(ctx, sessionId, {
    content: message.content,
    messageKind: message.messageKind || 'chat',
  });

  return sessionId;
}

export async function queueAssistantInterruption(
  ctx: WebUiContext,
  interruption: {
    content: string;
  }
): Promise<number | null> {
  return queueAssistantMessage(ctx, {
    content: interruption.content,
    messageKind: 'notification',
    openNewChatIfNone: false,
  });
}
