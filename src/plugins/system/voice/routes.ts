import type { Express, Request, Response, NextFunction } from 'express';
import { type MikroORM } from '@mikro-orm/sqlite';
import {
  type Conversation,
  startConversation,
  TaskAssistants,
  AgentSystem,
} from '../../../lib.js';
import { PluginHookInvocations } from '../../../lib/plugin-hooks.js';
import { extractVoiceAccessToken, isVoiceAccessTokenValid } from './auth.js';
import {
  isManagedVoiceClientRunning,
  type ManagedVoiceClientState,
} from './managed-client.js';
import { markdownToTts } from './markdown-to-tts.js';
import { createPluginLogger } from '../../../lib/plugin-logger.js';
import { VoiceSessionStore } from './voice-session-store.js';

const logger = createPluginLogger('voice');

type ActiveVoiceSession = {
  conversation: Conversation;
  lastActivityAt: number;
  requestedConversationEnd: boolean;
};

type DeferredVoiceSessionClose = {
  conversation: Conversation;
  closePromise: Promise<void> | null;
};

type VoiceClientEvent = {
  sequence: number;
  type: 'archiving-started' | 'archiving-completed';
  createdAtMs: number;
};

type VoiceCaptureDebugConfig = {
  minCaptureSeconds: number;
  maxCaptureSeconds: number;
  trailingSilenceMs: number;
  speechThreshold: number;
  prerollMs: number;
};

type VoiceCaptureDebugState = {
  source: string;
  stopReason: string;
  capturedSeconds: number | null;
  speechDetected: boolean;
  minCaptureSeconds: number;
  maxCaptureSeconds: number;
  trailingSilenceMs: number;
  speechThreshold: number;
  prerollMs: number;
  clientRecordedAt: string;
  serverReportedAtMs: number;
};

export type VoicePluginRuntimeState = {
  accessToken: string | null;
  managedClientState: ManagedVoiceClientState;
  /** The database ORM instance, set once the memory plugin initializes the database. */
  orm: MikroORM | null;
  /** The database ID of the currently active voice session, or null if none is active. */
  activeVoiceSessionId: number | null;
  /** In-memory conversation object for the active voice session. */
  activeVoiceSession: ActiveVoiceSession | null;
  sessionIdleTimeoutMs: number;
  deferredSessionCloseDelayMs: number;
  pendingVoiceSessionCloses: Set<DeferredVoiceSessionClose>;
  captureDebugConfig: VoiceCaptureDebugConfig;
  lastCaptureDebug: VoiceCaptureDebugState | null;
  nextVoiceClientEventSequence: number;
  voiceClientEvents: VoiceClientEvent[];
};

type VoiceTurnRequestBody = {
  message?: string;
};

type VoiceTurnResponseBody = {
  reply: string;
  continueConversation: boolean;
  endConversation: boolean;
  /** If a task assistant is now active, its definition id and name. */
  activeTaskAssistant?: {
    id: string;
    name: string;
  };
  /** Active session-linked agents for this voice session. */
  activeAgents?: Array<{
    instanceId: string;
    agentId: string;
    agentName: string;
    status: string;
  }>;
};

type VoiceContinuationTimeoutResponseBody = {
  ok: boolean;
  closedConversation: boolean;
};

type VoiceCaptureDebugRequestBody = {
  source?: unknown;
  stopReason?: unknown;
  capturedSeconds?: unknown;
  speechDetected?: unknown;
  minCaptureSeconds?: unknown;
  maxCaptureSeconds?: unknown;
  trailingSilenceMs?: unknown;
  speechThreshold?: unknown;
  prerollMs?: unknown;
  clientRecordedAt?: unknown;
};

function enqueueVoiceClientEvent(
  runtimeState: VoicePluginRuntimeState,
  type: VoiceClientEvent['type']
): void {
  runtimeState.voiceClientEvents.push({
    sequence: runtimeState.nextVoiceClientEventSequence,
    type,
    createdAtMs: Date.now(),
  });
  runtimeState.nextVoiceClientEventSequence += 1;

  if (runtimeState.voiceClientEvents.length > 32) {
    runtimeState.voiceClientEvents.splice(
      0,
      runtimeState.voiceClientEvents.length - 32
    );
  }
}

function getVoiceClientEventsAfter(
  runtimeState: VoicePluginRuntimeState,
  afterSequence: number
): VoiceClientEvent[] {
  return runtimeState.voiceClientEvents.filter(
    event => event.sequence > afterSequence
  );
}

function parseAfterSequence(queryValue: unknown): number {
  if (typeof queryValue === 'string') {
    const parsed = Number.parseInt(queryValue, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  if (Array.isArray(queryValue) && typeof queryValue[0] === 'string') {
    const parsed = Number.parseInt(queryValue[0], 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  return 0;
}

function updateLastCaptureDebug(
  runtimeState: VoicePluginRuntimeState,
  body: VoiceCaptureDebugRequestBody
): boolean {
  if (
    typeof body.source !== 'string' ||
    typeof body.stopReason !== 'string' ||
    typeof body.speechDetected !== 'boolean'
  ) {
    return false;
  }

  if (
    (body.capturedSeconds !== null &&
      typeof body.capturedSeconds !== 'number') ||
    typeof body.minCaptureSeconds !== 'number' ||
    typeof body.maxCaptureSeconds !== 'number' ||
    typeof body.trailingSilenceMs !== 'number' ||
    typeof body.speechThreshold !== 'number' ||
    typeof body.prerollMs !== 'number' ||
    typeof body.clientRecordedAt !== 'string'
  ) {
    return false;
  }

  const capturedSeconds =
    typeof body.capturedSeconds === 'number' ? body.capturedSeconds : null;

  runtimeState.lastCaptureDebug = {
    source: body.source,
    stopReason: body.stopReason,
    capturedSeconds,
    speechDetected: body.speechDetected,
    minCaptureSeconds: body.minCaptureSeconds,
    maxCaptureSeconds: body.maxCaptureSeconds,
    trailingSilenceMs: body.trailingSilenceMs,
    speechThreshold: body.speechThreshold,
    prerollMs: body.prerollMs,
    clientRecordedAt: body.clientRecordedAt,
    serverReportedAtMs: Date.now(),
  };

  return true;
}

function requireVoiceAccessToken(runtimeState: VoicePluginRuntimeState) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractVoiceAccessToken(
      req.headers as Record<string, string | string[] | undefined>
    );
    if (!isVoiceAccessTokenValid(runtimeState.accessToken, token)) {
      res.status(401).json({ error: 'Unauthorized voice client request.' });
      return;
    }

    next();
  };
}

function hasActiveVoiceSessionExpired(
  runtimeState: VoicePluginRuntimeState
): boolean {
  if (!runtimeState.activeVoiceSession) {
    return false;
  }

  return (
    Date.now() - runtimeState.activeVoiceSession.lastActivityAt >
    runtimeState.sessionIdleTimeoutMs
  );
}

export function requestActiveVoiceConversationEnd(
  runtimeState: VoicePluginRuntimeState
): boolean {
  if (!runtimeState.activeVoiceSession) {
    return false;
  }

  runtimeState.activeVoiceSession.requestedConversationEnd = true;
  runtimeState.activeVoiceSession.lastActivityAt = Date.now();
  return true;
}

function finalizeDeferredVoiceSessionClose(
  runtimeState: VoicePluginRuntimeState,
  deferredClose: DeferredVoiceSessionClose
): Promise<void> {
  if (deferredClose.closePromise) {
    return deferredClose.closePromise;
  }

  deferredClose.closePromise = (async () => {
    logger.log(
      'voice plugin: finalizing voice conversation and archiving immediately.'
    );
    enqueueVoiceClientEvent(runtimeState, 'archiving-started');
    await PluginHookInvocations.invokeOnUserConversationWillEnd(
      deferredClose.conversation,
      'voice'
    );
    await deferredClose.conversation.closeConversation();
  })()
    .catch(error => {
      logger.error('voice plugin: voice session cleanup failed:', error);
    })
    .finally(() => {
      enqueueVoiceClientEvent(runtimeState, 'archiving-completed');
      runtimeState.pendingVoiceSessionCloses.delete(deferredClose);
    });

  return deferredClose.closePromise;
}

function scheduleDeferredVoiceSessionClose(
  runtimeState: VoicePluginRuntimeState,
  conversation: Conversation
): void {
  const deferredClose: DeferredVoiceSessionClose = {
    conversation,
    closePromise: null,
  };

  runtimeState.pendingVoiceSessionCloses.add(deferredClose);
  logger.log(
    'voice plugin: closing stale voice session without deferred archival delay.'
  );
  void finalizeDeferredVoiceSessionClose(runtimeState, deferredClose);
}

export async function flushDeferredVoiceSessionCloses(
  runtimeState: VoicePluginRuntimeState
): Promise<void> {
  const pendingCloses = [...runtimeState.pendingVoiceSessionCloses];
  await Promise.allSettled(
    pendingCloses.map(deferredClose =>
      finalizeDeferredVoiceSessionClose(runtimeState, deferredClose)
    )
  );
}

export async function closeActiveVoiceSession(
  runtimeState: VoicePluginRuntimeState,
  options: { deferFinalization?: boolean } = {}
): Promise<void> {
  if (!runtimeState.activeVoiceSession) {
    return;
  }

  const { conversation } = runtimeState.activeVoiceSession;
  const sessionId = runtimeState.activeVoiceSessionId;

  // Cancel any active task assistant for this session before closing
  if (sessionId) {
    const activeTaskAssistant = TaskAssistants.getActiveInstance(sessionId);
    if (activeTaskAssistant) {
      logger.log(
        `voice plugin: cancelling active task assistant "${activeTaskAssistant.definition.name}" before closing session ${sessionId}.`
      );
      await TaskAssistants.cancel(sessionId);
    }

    // Cancel any session-linked agents for this session
    const activeAgents = AgentSystem.getInstancesBySession(sessionId);
    if (activeAgents.length > 0) {
      logger.log(
        `voice plugin: cancelling ${activeAgents.length} active agent(s) before closing session ${sessionId}.`
      );
      AgentSystem.cancelBySession(sessionId);
    }
  }

  runtimeState.activeVoiceSession = null;
  runtimeState.activeVoiceSessionId = null;

  // Archive the database session
  if (runtimeState.orm && sessionId) {
    try {
      await VoiceSessionStore.archiveSession(runtimeState.orm, sessionId);
      logger.log(`voice plugin: archived voice session record ${sessionId}.`);
    } catch (error) {
      logger.error(
        `voice plugin: failed to archive voice session record ${sessionId}:`,
        error
      );
    }
  }

  if (options.deferFinalization) {
    scheduleDeferredVoiceSessionClose(runtimeState, conversation);
    return;
  }

  const deferredClose: DeferredVoiceSessionClose = {
    conversation,
    closePromise: null,
  };

  runtimeState.pendingVoiceSessionCloses.add(deferredClose);
  await finalizeDeferredVoiceSessionClose(runtimeState, deferredClose);
}

/**
 * Set aside the active voice session instead of archiving it.
 * Persists the conversation context to the database so it can be
 * resumed later. This is called when a session times out rather
 * than when the user explicitly ends it.
 */
async function setAsideActiveVoiceSession(
  runtimeState: VoicePluginRuntimeState
): Promise<void> {
  if (!runtimeState.activeVoiceSession) {
    return;
  }

  const { conversation } = runtimeState.activeVoiceSession;
  const sessionId = runtimeState.activeVoiceSessionId;

  // Cancel any active task assistant for this session before setting aside
  if (sessionId) {
    const activeTaskAssistant = TaskAssistants.getActiveInstance(sessionId);
    if (activeTaskAssistant) {
      logger.log(
        `voice plugin: cancelling active task assistant "${activeTaskAssistant.definition.name}" before setting aside session ${sessionId}.`
      );
      await TaskAssistants.cancel(sessionId);
    }

    // Cancel any session-linked agents for this session
    const activeAgents = AgentSystem.getInstancesBySession(sessionId);
    if (activeAgents.length > 0) {
      logger.log(
        `voice plugin: cancelling ${activeAgents.length} active agent(s) before setting aside session ${sessionId}.`
      );
      AgentSystem.cancelBySession(sessionId);
    }
  }

  // Persist unsynchronized messages before setting aside
  if (runtimeState.orm && sessionId) {
    try {
      const session = await VoiceSessionStore.getSession(
        runtimeState.orm,
        sessionId
      );
      if (session) {
        await VoiceSessionStore.persistUnsynchronizedMessages(
          runtimeState.orm,
          session,
          conversation
        );
        await VoiceSessionStore.setAsideSession(
          runtimeState.orm,
          sessionId,
          conversation
        );
        logger.log(`voice plugin: set aside voice session ${sessionId}.`);
      }
    } catch (error) {
      logger.error(
        `voice plugin: failed to set aside voice session ${sessionId}:`,
        error
      );
    }
  }

  // Clear the in-memory session state
  runtimeState.activeVoiceSession = null;
  runtimeState.activeVoiceSessionId = null;

  // Fire the conversation will-end hook but don't close/archive yet
  await PluginHookInvocations.invokeOnUserConversationWillEnd(
    conversation,
    'voice'
  );
}

async function getOrCreateActiveVoiceConversation(
  runtimeState: VoicePluginRuntimeState
): Promise<Conversation> {
  if (hasActiveVoiceSessionExpired(runtimeState)) {
    logger.log(
      'voice plugin: active voice session expired, setting it aside before starting a fresh conversation.'
    );
    await setAsideActiveVoiceSession(runtimeState);
  }

  if (runtimeState.activeVoiceSession) {
    runtimeState.activeVoiceSession.lastActivityAt = Date.now();
    return runtimeState.activeVoiceSession.conversation;
  }

  const conversation = startConversation('voice');
  logger.log('voice plugin: started a new voice conversation.');
  await PluginHookInvocations.invokeOnUserConversationWillBegin(
    conversation,
    'voice'
  );

  // Create a database record for this voice session
  if (runtimeState.orm) {
    try {
      const session = await VoiceSessionStore.createSession(runtimeState.orm, {
        conversationType: 'voice',
      });
      runtimeState.activeVoiceSessionId = session.id;
      conversation.sessionId = session.id;
      logger.log(
        `voice plugin: created voice session record ${session.id} for new conversation.`
      );
    } catch (error) {
      logger.error(
        'voice plugin: failed to create voice session record:',
        error
      );
    }
  }

  runtimeState.activeVoiceSession = {
    conversation,
    lastActivityAt: Date.now(),
    requestedConversationEnd: false,
  };

  return conversation;
}

export function registerVoiceRoutes(
  app: Express,
  runtimeState: VoicePluginRuntimeState
): void {
  const requireToken = requireVoiceAccessToken(runtimeState);

  app.get('/api/voice/health', requireToken, async (_req, res) => {
    const pendingDeferredCloses = [...runtimeState.pendingVoiceSessionCloses];

    let setAsideSessionCount = 0;
    if (runtimeState.orm) {
      try {
        const setAsideSessions = await VoiceSessionStore.getSetAsideSessions(
          runtimeState.orm
        );
        setAsideSessionCount = setAsideSessions.length;
      } catch {
        // Ignore — health endpoint should not fail on DB errors
      }
    }

    // Get active agents for the current voice session
    const activeAgents = runtimeState.activeVoiceSessionId
      ? AgentSystem.getInstancesBySession(runtimeState.activeVoiceSessionId)
      : [];

    res.json({
      ok: true,
      hasAccessToken: !!runtimeState.accessToken,
      managedClientRunning: isManagedVoiceClientRunning(
        runtimeState.managedClientState
      ),
      hasActiveVoiceSession: !!runtimeState.activeVoiceSession,
      activeVoiceSessionId: runtimeState.activeVoiceSessionId,
      setAsideSessionCount,
      activeAgentCount: activeAgents.length,
      sessionIdleTimeoutMs: runtimeState.sessionIdleTimeoutMs,
      deferredSessionCloseDelayMs: runtimeState.deferredSessionCloseDelayMs,
      pendingSessionCloseCount: runtimeState.pendingVoiceSessionCloses.size,
      latestEventSequence: runtimeState.nextVoiceClientEventSequence - 1,
      debug: {
        session: {
          activeSessionAgeMs: runtimeState.activeVoiceSession
            ? Date.now() - runtimeState.activeVoiceSession.lastActivityAt
            : null,
          deferredCloseState: {
            pendingCount: pendingDeferredCloses.length,
            scheduledCount: 0,
            inFlightCount: pendingDeferredCloses.filter(
              deferredClose => deferredClose.closePromise !== null
            ).length,
          },
        },
        capture: runtimeState.captureDebugConfig,
        lastCapture: runtimeState.lastCaptureDebug,
      },
    });
  });

  app.get('/api/voice/events', requireToken, (req, res) => {
    const afterSequence = parseAfterSequence(req.query.afterSequence);

    res.json({
      ok: true,
      latestSequence: runtimeState.nextVoiceClientEventSequence - 1,
      events: getVoiceClientEventsAfter(runtimeState, afterSequence),
    });
  });

  app.post('/api/voice/debug/capture', requireToken, (req, res) => {
    const body = (req.body ?? {}) as VoiceCaptureDebugRequestBody;

    if (!updateLastCaptureDebug(runtimeState, body)) {
      res
        .status(400)
        .json({ error: 'Voice capture debug payload is invalid.' });
      return;
    }

    res.json({ ok: true });
  });

  app.post('/api/voice/continue-timeout', requireToken, async (_req, res) => {
    const closedConversation = !!runtimeState.activeVoiceSession;

    if (closedConversation) {
      logger.log(
        'voice plugin: continuation turn ended in silence, setting aside voice conversation.'
      );
      await setAsideActiveVoiceSession(runtimeState);
    }

    const responseBody: VoiceContinuationTimeoutResponseBody = {
      ok: true,
      closedConversation,
    };

    res.json(responseBody);
  });

  app.post('/api/voice/turn', requireToken, async (req, res) => {
    const body = (req.body ?? {}) as VoiceTurnRequestBody;
    const message = body.message?.trim();

    if (!message) {
      res.status(400).json({
        error: 'Voice turn request must include a non-empty message.',
      });
      return;
    }

    try {
      const conversation =
        await getOrCreateActiveVoiceConversation(runtimeState);
      if (runtimeState.activeVoiceSession?.conversation === conversation) {
        runtimeState.activeVoiceSession.requestedConversationEnd = false;
      }

      const sessionId = runtimeState.activeVoiceSessionId;
      let reply: string;

      // Check if there's an active task assistant for this voice session.
      // If so, route the user's message to the task assistant's conversation
      // instead of the parent voice conversation.
      const activeTaskAssistant = sessionId
        ? TaskAssistants.getActiveInstance(sessionId)
        : undefined;

      if (activeTaskAssistant) {
        // Route to the task assistant's conversation
        await activeTaskAssistant.conversation.appendExternalMessage({
          role: 'user',
          content: message,
        });
        await activeTaskAssistant.conversation.sendUserMessage();
        // The task assistant's reply is the last assistant message in its conversation
        const taskAssistantContext =
          activeTaskAssistant.conversation.rawContext;
        const lastAssistantMessage = [...taskAssistantContext]
          .reverse()
          .find(msg => msg.role === 'assistant');
        reply = lastAssistantMessage?.content ?? '';

        // Persist task assistant messages to the database
        if (runtimeState.orm && sessionId) {
          try {
            const session = await VoiceSessionStore.getSession(
              runtimeState.orm,
              sessionId
            );
            if (session) {
              await VoiceSessionStore.persistUnsynchronizedMessages(
                runtimeState.orm,
                session,
                activeTaskAssistant.conversation,
                'tool_call'
              );
            }
          } catch (error) {
            logger.error(
              'voice plugin: failed to persist task assistant messages:',
              error
            );
          }
        }

        // If the task assistant completed during this turn, inject the
        // handback message into the parent voice conversation and let
        // the main assistant wrap up.
        const completedResult = sessionId
          ? TaskAssistants.getAndClearCompletedResult(sessionId)
          : undefined;

        if (completedResult) {
          logger.log(
            `voice plugin: task assistant "${completedResult.taskAssistantName}" completed during voice turn.`
          );
          await conversation.appendExternalMessage({
            role: 'system',
            content:
              `Task assistant "${completedResult.taskAssistantName}" has completed.\n\n` +
              completedResult.handbackMessage,
          });
          const handbackReply = await conversation.sendUserMessage();
          reply = handbackReply;

          // Persist the handback exchange to the database
          if (runtimeState.orm && sessionId) {
            try {
              const session = await VoiceSessionStore.getSession(
                runtimeState.orm,
                sessionId
              );
              if (session) {
                await VoiceSessionStore.persistUnsynchronizedMessages(
                  runtimeState.orm,
                  session,
                  conversation
                );
              }
            } catch (error) {
              logger.error(
                'voice plugin: failed to persist handback messages:',
                error
              );
            }
          }
        }
      } else {
        // Normal voice conversation turn

        // Drain any pending agent messages into the LLM context before processing
        if (sessionId) {
          const pendingAgentMessages =
            AgentSystem.getAndClearPendingMessages(sessionId);
          for (const agentMsg of pendingAgentMessages) {
            await conversation.appendExternalMessage({
              role: 'system',
              content: `## ${agentMsg.heading}\n\n${agentMsg.content}`,
            });
          }
        }

        reply = await conversation.sendUserMessage(message);

        // Persist unsynchronized messages to the database
        if (runtimeState.orm && sessionId) {
          try {
            const session = await VoiceSessionStore.getSession(
              runtimeState.orm,
              sessionId
            );
            if (session) {
              await VoiceSessionStore.persistUnsynchronizedMessages(
                runtimeState.orm,
                session,
                conversation
              );
            }
          } catch (error) {
            logger.error(
              'voice plugin: failed to persist voice session messages:',
              error
            );
          }
        }

        // If the parent LLM called a task assistant start tool during this turn,
        // persist the task assistant's seed messages so they appear in the DB.
        const newTaskAssistant = sessionId
          ? TaskAssistants.getActiveInstance(sessionId)
          : undefined;
        if (newTaskAssistant && runtimeState.orm && sessionId) {
          try {
            const session = await VoiceSessionStore.getSession(
              runtimeState.orm,
              sessionId
            );
            if (session) {
              await VoiceSessionStore.persistUnsynchronizedMessages(
                runtimeState.orm,
                session,
                newTaskAssistant.conversation,
                'tool_call'
              );
            }
          } catch (error) {
            logger.error(
              'voice plugin: failed to persist task assistant seed messages:',
              error
            );
          }
        }
      }

      const endConversation =
        runtimeState.activeVoiceSession?.conversation === conversation
          ? runtimeState.activeVoiceSession.requestedConversationEnd
          : false;

      if (endConversation) {
        logger.log(
          'voice plugin: assistant requested the current voice conversation to end after this reply.'
        );
        await closeActiveVoiceSession(runtimeState, {
          deferFinalization: true,
        });
      } else if (
        runtimeState.activeVoiceSession?.conversation === conversation
      ) {
        runtimeState.activeVoiceSession.lastActivityAt = Date.now();
      }

      // Check if a task assistant is now active for this session
      const currentTaskAssistant = sessionId
        ? TaskAssistants.getActiveInstance(sessionId)
        : undefined;

      // Check for active session-linked agents
      const currentAgents = sessionId
        ? AgentSystem.getInstancesBySession(sessionId)
        : [];

      const responseBody: VoiceTurnResponseBody = {
        reply: markdownToTts(reply),
        continueConversation: !endConversation,
        endConversation,
        activeTaskAssistant: currentTaskAssistant
          ? {
              id: currentTaskAssistant.definition.id,
              name: currentTaskAssistant.definition.name,
            }
          : undefined,
        activeAgents:
          currentAgents.length > 0
            ? currentAgents.map(agent => ({
                instanceId: agent.instanceId,
                agentId: agent.agentId,
                agentName: agent.agentName,
                status: agent.status,
              }))
            : undefined,
      };

      res.json(responseBody);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: messageText });
    }
  });

  // --- Set-aside session management endpoints ---

  /**
   * GET /api/voice/set-aside-sessions
   * Returns a list of set-aside voice sessions that can be resumed.
   */
  app.get('/api/voice/set-aside-sessions', requireToken, async (_req, res) => {
    if (!runtimeState.orm) {
      res.status(503).json({
        error: 'Voice session persistence is not available yet.',
      });
      return;
    }

    try {
      const sessions = await VoiceSessionStore.getSetAsideSessions(
        runtimeState.orm
      );
      res.json({
        ok: true,
        sessions: sessions.map(session => ({
          id: session.id,
          conversationType: session.conversationType,
          title: session.title,
          lastActivityAt: session.lastActivityAt,
          createdAt: session.createdAt,
        })),
      });
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: messageText });
    }
  });

  /**
   * POST /api/voice/resume-session/:id
   * Resumes a set-aside voice session by ID.
   * Only works if no other voice session is currently active.
   */
  app.post('/api/voice/resume-session/:id', requireToken, async (req, res) => {
    if (!runtimeState.orm) {
      res.status(503).json({
        error: 'Voice session persistence is not available yet.',
      });
      return;
    }

    // Don't allow resuming if there's already an active session
    if (runtimeState.activeVoiceSession) {
      res.status(409).json({
        error:
          'Cannot resume a set-aside session while another voice session is active.',
      });
      return;
    }

    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      res.status(400).json({ error: 'Invalid session ID.' });
      return;
    }

    try {
      const session = await VoiceSessionStore.getSession(
        runtimeState.orm,
        sessionId
      );

      if (!session || session.status !== 'set_aside') {
        res.status(404).json({
          error: 'Set-aside session not found or not in a resumable state.',
        });
        return;
      }

      // Resume the session in the database
      await VoiceSessionStore.resumeSession(runtimeState.orm, sessionId);

      // Restore the conversation from the persisted context
      const conversation =
        VoiceSessionStore.restoreConversationFromSession(session);

      runtimeState.activeVoiceSessionId = sessionId;
      runtimeState.activeVoiceSession = {
        conversation,
        lastActivityAt: Date.now(),
        requestedConversationEnd: false,
      };

      logger.log(`voice plugin: resumed set-aside voice session ${sessionId}.`);

      res.json({
        ok: true,
        sessionId,
        conversationType: session.conversationType,
        title: session.title,
      });
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: messageText });
    }
  });

  /**
   * POST /api/voice/discard-session/:id
   * Archives a set-aside voice session by ID, discarding its context.
   */
  app.post('/api/voice/discard-session/:id', requireToken, async (req, res) => {
    if (!runtimeState.orm) {
      res.status(503).json({
        error: 'Voice session persistence is not available yet.',
      });
      return;
    }

    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      res.status(400).json({ error: 'Invalid session ID.' });
      return;
    }

    try {
      const session = await VoiceSessionStore.getSession(
        runtimeState.orm,
        sessionId
      );

      if (!session || session.status !== 'set_aside') {
        res.status(404).json({
          error: 'Set-aside session not found or not in a discardable state.',
        });
        return;
      }

      await VoiceSessionStore.archiveSession(runtimeState.orm, sessionId);

      logger.log(
        `voice plugin: discarded (archived) set-aside voice session ${sessionId}.`
      );

      res.json({ ok: true, sessionId });
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: messageText });
    }
  });

  // --- Web UI management endpoints (no voice access token required) ---
  // These endpoints are for the web UI to manage voice sessions.
  // They are local-only and do not require the voice client access token.

  /**
   * GET /api/voice/sessions
   * List all voice sessions (active, set-aside, and recent archived).
   * For the web UI management page.
   */
  app.get('/api/voice/sessions', async (_req, res) => {
    if (!runtimeState.orm) {
      res.status(503).json({
        error: 'Voice session persistence is not available yet.',
      });
      return;
    }

    try {
      const liveSessions = await VoiceSessionStore.getLiveSessions(
        runtimeState.orm
      );

      // Also include the in-memory active session info
      const activeSessionInfo = runtimeState.activeVoiceSession
        ? {
            id: runtimeState.activeVoiceSessionId,
            status: 'active_in_memory' as const,
            conversationType: 'voice',
            title: '',
            lastActivityAt: new Date(
              runtimeState.activeVoiceSession.lastActivityAt
            ).toISOString(),
            createdAt: '',
            hasActiveConversation: true,
          }
        : null;

      res.json({
        ok: true,
        activeSession: activeSessionInfo,
        sessions: liveSessions.map(session => ({
          id: session.id,
          status: session.status,
          conversationType: session.conversationType,
          title: session.title,
          taskAssistantId: session.taskAssistantId,
          agentInstanceId: session.agentInstanceId,
          parentSessionId: session.parentSessionId,
          lastActivityAt: session.lastActivityAt,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        })),
      });
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: messageText });
    }
  });

  /**
   * DELETE /api/voice/sessions/:id
   * Archive (evict) a set-aside voice session immediately.
   * For the web UI management page.
   */
  app.delete('/api/voice/sessions/:id', async (req, res) => {
    if (!runtimeState.orm) {
      res.status(503).json({
        error: 'Voice session persistence is not available yet.',
      });
      return;
    }

    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      res.status(400).json({ error: 'Invalid session ID.' });
      return;
    }

    try {
      const session = await VoiceSessionStore.getSession(
        runtimeState.orm,
        sessionId
      );

      if (!session) {
        res.status(404).json({ error: 'Session not found.' });
        return;
      }

      if (session.status !== 'set_aside') {
        res.status(400).json({
          error: `Cannot evict session in "${session.status}" state. Only set_aside sessions can be evicted.`,
        });
        return;
      }

      await VoiceSessionStore.archiveSession(runtimeState.orm, sessionId);

      logger.log(
        `voice plugin: evicted set-aside voice session ${sessionId} via web UI.`
      );

      res.json({ ok: true, sessionId });
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: messageText });
    }
  });

  /**
   * POST /api/voice/sessions/:id/resume
   * Resume a set-aside voice session via the web UI.
   * Only works if no other voice session is currently active.
   */
  app.post('/api/voice/sessions/:id/resume', async (req, res) => {
    if (!runtimeState.orm) {
      res.status(503).json({
        error: 'Voice session persistence is not available yet.',
      });
      return;
    }

    // Don't allow resuming if there's already an active session
    if (runtimeState.activeVoiceSession) {
      res.status(409).json({
        error:
          'Cannot resume a set-aside session while another voice session is active.',
      });
      return;
    }

    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      res.status(400).json({ error: 'Invalid session ID.' });
      return;
    }

    try {
      const session = await VoiceSessionStore.getSession(
        runtimeState.orm,
        sessionId
      );

      if (!session || session.status !== 'set_aside') {
        res.status(404).json({
          error: 'Set-aside session not found or not in a resumable state.',
        });
        return;
      }

      // Resume the session in the database
      await VoiceSessionStore.resumeSession(runtimeState.orm, sessionId);

      // Restore the conversation from the persisted context
      const conversation =
        VoiceSessionStore.restoreConversationFromSession(session);

      runtimeState.activeVoiceSessionId = sessionId;
      runtimeState.activeVoiceSession = {
        conversation,
        lastActivityAt: Date.now(),
        requestedConversationEnd: false,
      };

      logger.log(
        `voice plugin: resumed set-aside voice session ${sessionId} via web UI.`
      );

      res.json({
        ok: true,
        sessionId,
        conversationType: session.conversationType,
        title: session.title,
      });
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: messageText });
    }
  });
}
