/* eslint-disable @typescript-eslint/no-explicit-any -- MikroORM v7 defineEntity produces opaque Loaded<object, never, never, never> types that require `as any` casts for filter objects, property assignments, and em.create calls. */
import { type MikroORM } from '@mikro-orm/sqlite';
import { type Conversation, startConversation } from '../../../lib.js';
import type { ConversationTypeId } from '../../../lib/conversation-types.js';
import { VoiceSession } from './db-schemas/VoiceSession.js';
import { VoiceSessionRound } from './db-schemas/VoiceSessionRound.js';
import { createPluginLogger } from '../../../lib/plugin-logger.js';

const logger = createPluginLogger('voice-session-store');

/**
 * Maximum number of voice sessions that can exist simultaneously
 * (active + set_aside). When this limit is reached, the oldest
 * set_aside session is archived before a new one can be created.
 */
export const MAX_VOICE_SESSIONS = 2;

/**
 * Manages voice session persistence in the database.
 *
 * Voice sessions can be in one of four states:
 * - `active`: Currently in use by the voice client.
 * - `set_aside`: Timed out or interrupted; context persisted for possible resume.
 * - `archiving`: Being summarized and archived (transient state).
 * - `archived`: Fully archived; context has been summarized and evicted.
 */
export const VoiceSessionStore = {
  /**
   * Create a new voice session in the database.
   */
  async createSession(
    orm: MikroORM,
    options: {
      conversationType?: string;
      taskAssistantId?: string | null;
      agentInstanceId?: string | null;
      parentSessionId?: number | null;
    } = {}
  ): Promise<VoiceSession> {
    const em = orm.em.fork();
    const now = new Date();
    const session = em.create(VoiceSession, {
      status: 'active',
      conversationType: options.conversationType ?? 'voice',
      title: '',
      compactedContext: null,
      rawContext: null,
      taskAssistantId: options.taskAssistantId ?? null,
      agentInstanceId: options.agentInstanceId ?? null,
      parentSessionId: options.parentSessionId ?? null,
      rounds: [],
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
    await em.flush();
    logger.log(
      `Created voice session ${session.id} (type: ${session.conversationType})`
    );
    return session;
  },

  /**
   * Get a voice session by ID.
   */
  async getSession(orm: MikroORM, id: number): Promise<VoiceSession | null> {
    const em = orm.em.fork();
    return em.findOne(VoiceSession, { id } as any, {
      populate: ['rounds'],
    }) as Promise<VoiceSession | null>;
  },

  /**
   * Get the currently active voice session (if any).
   */
  async getActiveSession(orm: MikroORM): Promise<VoiceSession | null> {
    const em = orm.em.fork();
    return em.findOne(VoiceSession, { status: 'active' } as any, {
      populate: ['rounds'],
    }) as Promise<VoiceSession | null>;
  },

  /**
   * Get all set-aside voice sessions, ordered by most recently active first.
   */
  async getSetAsideSessions(orm: MikroORM): Promise<VoiceSession[]> {
    const em = orm.em.fork();
    return em.find(VoiceSession, { status: 'set_aside' } as any, {
      populate: ['rounds'],
    }) as Promise<VoiceSession[]>;
  },

  /**
   * Get all non-archived voice sessions (active + set_aside).
   */
  async getLiveSessions(orm: MikroORM): Promise<VoiceSession[]> {
    const em = orm.em.fork();
    return em.find(
      VoiceSession,
      { status: { $in: ['active', 'set_aside'] } } as any,
      {
        populate: ['rounds'],
      }
    ) as Promise<VoiceSession[]>;
  },

  /**
   * Count the number of live (active + set_aside) voice sessions.
   */
  async countLiveSessions(orm: MikroORM): Promise<number> {
    const em = orm.em.fork();
    return em.count(VoiceSession, {
      status: { $in: ['active', 'set_aside'] },
    } as any);
  },

  /**
   * Update a voice session's fields.
   */
  async updateSession(
    orm: MikroORM,
    id: number,
    updates: {
      status?: string;
      title?: string;
      compactedContext?: unknown;
      rawContext?: unknown;
      lastActivityAt?: Date;
    }
  ): Promise<VoiceSession> {
    const em = orm.em.fork();
    const session = (await em.findOneOrFail(VoiceSession, {
      id,
    } as any)) as VoiceSession;
    if (updates.status !== undefined) session.status = updates.status as any;
    if (updates.title !== undefined) session.title = updates.title as any;
    if (updates.compactedContext !== undefined)
      session.compactedContext = updates.compactedContext as any;
    if (updates.rawContext !== undefined)
      session.rawContext = updates.rawContext as any;
    if (updates.lastActivityAt !== undefined)
      session.lastActivityAt = updates.lastActivityAt;
    session.updatedAt = new Date();
    await em.flush();
    return session;
  },

  /**
   * Mark a voice session as set_aside, persisting its conversation context.
   * If the max number of live sessions would be exceeded, the oldest
   * set_aside session is archived first.
   */
  async setAsideSession(
    orm: MikroORM,
    id: number,
    conversation: Conversation
  ): Promise<VoiceSession> {
    // Enforce max session limit before setting aside
    await VoiceSessionStore.enforceMaxSessions(orm);

    const em = orm.em.fork();
    const session = (await em.findOneOrFail(VoiceSession, {
      id,
    } as any)) as VoiceSession;

    // Persist conversation context
    session.status = 'set_aside' as any;
    session.compactedContext = conversation.compactedContext as any;
    session.rawContext = conversation.rawContext as any;
    session.updatedAt = new Date();
    await em.flush();

    logger.log(`Set aside voice session ${id}`);
    return session;
  },

  /**
   * Mark a voice session as active again (resume from set_aside).
   */
  async resumeSession(orm: MikroORM, id: number): Promise<VoiceSession> {
    const em = orm.em.fork();
    const session = (await em.findOneOrFail(VoiceSession, {
      id,
    } as any)) as VoiceSession;

    if (session.status !== 'set_aside') {
      throw new Error(
        `Cannot resume voice session ${id} with status "${session.status}". Only set_aside sessions can be resumed.`
      );
    }

    session.status = 'active' as any;
    session.updatedAt = new Date();
    session.lastActivityAt = new Date();
    await em.flush();

    logger.log(`Resumed voice session ${id}`);
    return session;
  },

  /**
   * Archive a voice session. This marks it as archived and clears
   * the persisted context (since it will have been summarized by
   * the conversation's closeConversation method).
   */
  async archiveSession(orm: MikroORM, id: number): Promise<VoiceSession> {
    const em = orm.em.fork();
    const session = (await em.findOneOrFail(VoiceSession, {
      id,
    } as any)) as VoiceSession;

    session.status = 'archived' as any;
    session.compactedContext = null as any;
    session.rawContext = null as any;
    session.updatedAt = new Date();
    await em.flush();

    logger.log(`Archived voice session ${id}`);
    return session;
  },

  /**
   * Persist unsynchronized messages from a conversation to the database
   * as VoiceSessionRound records.
   */
  async persistUnsynchronizedMessages(
    orm: MikroORM,
    session: VoiceSession,
    conversation: Conversation,
    messageKind: string = 'voice'
  ): Promise<void> {
    const unsynchronizedMessages = conversation.getUnsynchronizedMessages();
    if (unsynchronizedMessages.length === 0) {
      return;
    }

    const em = orm.em.fork();
    const managedSession = (await em.findOneOrFail(VoiceSession, {
      id: session.id,
    } as any)) as VoiceSession;

    for (const message of unsynchronizedMessages) {
      em.create(VoiceSessionRound, {
        voiceSession: managedSession,
        role: message.role,
        messageKind,
        content: message.content,
        timestamp: new Date(),
        toolCallData: message.tool_calls ?? null,
      } as any);
    }

    managedSession.updatedAt = new Date();
    await em.flush();
    conversation.markUnsynchronizedMessagesSynchronized();
  },

  /**
   * Restore a Conversation object from a persisted voice session.
   * Creates a new Conversation and restores its context from the
   * session's compactedContext and rawContext.
   */
  restoreConversationFromSession(
    session: VoiceSession,
    conversationType: ConversationTypeId = 'voice'
  ): Conversation {
    const conversation = startConversation(conversationType, {
      sessionId: session.id,
      taskAssistantId: session.taskAssistantId ?? undefined,
      agentInstanceId: session.agentInstanceId ?? undefined,
    });

    if (session.compactedContext && session.rawContext) {
      conversation.restoreContext(
        session.rawContext as any,
        session.compactedContext as any
      );
    }

    logger.log(
      `Restored conversation from voice session ${session.id} (type: ${conversationType})`
    );
    return conversation;
  },

  /**
   * Enforce the maximum number of live voice sessions.
   * If the limit is reached, the oldest set_aside session is archived.
   */
  async enforceMaxSessions(orm: MikroORM): Promise<void> {
    const liveCount = await VoiceSessionStore.countLiveSessions(orm);

    if (liveCount < MAX_VOICE_SESSIONS) {
      return;
    }

    // Find the oldest set_aside session and archive it
    const em = orm.em.fork();
    const oldestSetAside = (await em.findOne(
      VoiceSession,
      {
        status: 'set_aside',
      } as any,
      { orderBy: { lastActivityAt: 'asc' } as any }
    )) as VoiceSession | null;

    if (oldestSetAside) {
      logger.log(
        `Max voice sessions reached (${liveCount}/${MAX_VOICE_SESSIONS}). Archiving oldest set-aside session ${oldestSetAside.id}.`
      );
      await VoiceSessionStore.archiveSession(orm, oldestSetAside.id);
    }
  },
};
