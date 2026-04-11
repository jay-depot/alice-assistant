import type { Express, Request, Response, NextFunction } from 'express';
import { type Conversation, startConversation } from '../../../lib.js';
import { PluginHookInvocations } from '../../../lib/plugin-hooks.js';
import { extractVoiceAccessToken, isVoiceAccessTokenValid } from './auth.js';
import { isManagedVoiceClientRunning, type ManagedVoiceClientState } from './managed-client.js';
import { markdownToTts } from './markdown-to-tts.js';

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

function enqueueVoiceClientEvent(runtimeState: VoicePluginRuntimeState, type: VoiceClientEvent['type']): void {
  runtimeState.voiceClientEvents.push({
    sequence: runtimeState.nextVoiceClientEventSequence,
    type,
    createdAtMs: Date.now(),
  });
  runtimeState.nextVoiceClientEventSequence += 1;

  if (runtimeState.voiceClientEvents.length > 32) {
    runtimeState.voiceClientEvents.splice(0, runtimeState.voiceClientEvents.length - 32);
  }
}

function getVoiceClientEventsAfter(runtimeState: VoicePluginRuntimeState, afterSequence: number): VoiceClientEvent[] {
  return runtimeState.voiceClientEvents.filter((event) => event.sequence > afterSequence);
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

function updateLastCaptureDebug(runtimeState: VoicePluginRuntimeState, body: VoiceCaptureDebugRequestBody): boolean {
  if (typeof body.source !== 'string' || typeof body.stopReason !== 'string' || typeof body.speechDetected !== 'boolean') {
    return false;
  }

  if (
    (body.capturedSeconds !== null && typeof body.capturedSeconds !== 'number') ||
    typeof body.minCaptureSeconds !== 'number' ||
    typeof body.maxCaptureSeconds !== 'number' ||
    typeof body.trailingSilenceMs !== 'number' ||
    typeof body.speechThreshold !== 'number' ||
    typeof body.prerollMs !== 'number' ||
    typeof body.clientRecordedAt !== 'string'
  ) {
    return false;
  }

  const capturedSeconds = typeof body.capturedSeconds === 'number' ? body.capturedSeconds : null;

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
    const token = extractVoiceAccessToken(req.headers as Record<string, string | string[] | undefined>);
    if (!isVoiceAccessTokenValid(runtimeState.accessToken, token)) {
      res.status(401).json({ error: 'Unauthorized voice client request.' });
      return;
    }

    next();
  };
}

function hasActiveVoiceSessionExpired(runtimeState: VoicePluginRuntimeState): boolean {
  if (!runtimeState.activeVoiceSession) {
    return false;
  }

  return Date.now() - runtimeState.activeVoiceSession.lastActivityAt > runtimeState.sessionIdleTimeoutMs;
}

export function requestActiveVoiceConversationEnd(runtimeState: VoicePluginRuntimeState): boolean {
  if (!runtimeState.activeVoiceSession) {
    return false;
  }

  runtimeState.activeVoiceSession.requestedConversationEnd = true;
  runtimeState.activeVoiceSession.lastActivityAt = Date.now();
  return true;
}

function finalizeDeferredVoiceSessionClose(
  runtimeState: VoicePluginRuntimeState,
  deferredClose: DeferredVoiceSessionClose,
): Promise<void> {
  if (deferredClose.closePromise) {
    return deferredClose.closePromise;
  }

  deferredClose.closePromise = (async () => {
    console.log('voice plugin: finalizing voice conversation and archiving immediately.');
    enqueueVoiceClientEvent(runtimeState, 'archiving-started');
    await PluginHookInvocations.invokeOnUserConversationWillEnd(deferredClose.conversation, 'voice');
    await deferredClose.conversation.closeConversation();
  })().catch((error) => {
    console.error('voice plugin: voice session cleanup failed:', error);
  }).finally(() => {
    enqueueVoiceClientEvent(runtimeState, 'archiving-completed');
    runtimeState.pendingVoiceSessionCloses.delete(deferredClose);
  });

  return deferredClose.closePromise;
}

function scheduleDeferredVoiceSessionClose(runtimeState: VoicePluginRuntimeState, conversation: Conversation): void {
  const deferredClose: DeferredVoiceSessionClose = {
    conversation,
    closePromise: null,
  };

  runtimeState.pendingVoiceSessionCloses.add(deferredClose);
  console.log('voice plugin: closing stale voice session without deferred archival delay.');
  void finalizeDeferredVoiceSessionClose(runtimeState, deferredClose);
}

export async function flushDeferredVoiceSessionCloses(runtimeState: VoicePluginRuntimeState): Promise<void> {
  const pendingCloses = [...runtimeState.pendingVoiceSessionCloses];
  await Promise.allSettled(
    pendingCloses.map((deferredClose) => finalizeDeferredVoiceSessionClose(runtimeState, deferredClose)),
  );
}

export async function closeActiveVoiceSession(
  runtimeState: VoicePluginRuntimeState,
  options: { deferFinalization?: boolean } = {},
): Promise<void> {
  if (!runtimeState.activeVoiceSession) {
    return;
  }

  const { conversation } = runtimeState.activeVoiceSession;
  runtimeState.activeVoiceSession = null;

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

async function getOrCreateActiveVoiceConversation(runtimeState: VoicePluginRuntimeState): Promise<Conversation> {
  if (hasActiveVoiceSessionExpired(runtimeState)) {
    console.log('voice plugin: active voice session expired, closing it immediately before starting a fresh conversation.');
    await closeActiveVoiceSession(runtimeState);
  }

  if (runtimeState.activeVoiceSession) {
    runtimeState.activeVoiceSession.lastActivityAt = Date.now();
    return runtimeState.activeVoiceSession.conversation;
  }

  const conversation = startConversation('voice');
  console.log('voice plugin: started a new voice conversation.');
  await PluginHookInvocations.invokeOnUserConversationWillBegin(conversation, 'voice');

  runtimeState.activeVoiceSession = {
    conversation,
    lastActivityAt: Date.now(),
    requestedConversationEnd: false,
  };

  return conversation;
}

export function registerVoiceRoutes(app: Express, runtimeState: VoicePluginRuntimeState): void {
  const requireToken = requireVoiceAccessToken(runtimeState);

  app.get('/api/voice/health', requireToken, (_req, res) => {
    const pendingDeferredCloses = [...runtimeState.pendingVoiceSessionCloses];

    res.json({
      ok: true,
      hasAccessToken: !!runtimeState.accessToken,
      managedClientRunning: isManagedVoiceClientRunning(runtimeState.managedClientState),
      hasActiveVoiceSession: !!runtimeState.activeVoiceSession,
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
            inFlightCount: pendingDeferredCloses.filter((deferredClose) => deferredClose.closePromise !== null).length,
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
      res.status(400).json({ error: 'Voice capture debug payload is invalid.' });
      return;
    }

    res.json({ ok: true });
  });

  app.post('/api/voice/continue-timeout', requireToken, async (_req, res) => {
    const closedConversation = !!runtimeState.activeVoiceSession;

    if (closedConversation) {
      console.log('voice plugin: continuation turn ended in silence, closing voice conversation immediately.');
      await closeActiveVoiceSession(runtimeState, { deferFinalization: true });
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
      res.status(400).json({ error: 'Voice turn request must include a non-empty message.' });
      return;
    }

    try {
      const conversation = await getOrCreateActiveVoiceConversation(runtimeState);
      if (runtimeState.activeVoiceSession?.conversation === conversation) {
        runtimeState.activeVoiceSession.requestedConversationEnd = false;
      }

      const reply = await conversation.sendUserMessage(message);
      const endConversation = runtimeState.activeVoiceSession?.conversation === conversation
        ? runtimeState.activeVoiceSession.requestedConversationEnd
        : false;

      if (endConversation) {
        console.log('voice plugin: assistant requested the current voice conversation to end after this reply.');
        await closeActiveVoiceSession(runtimeState, { deferFinalization: true });
      } else if (runtimeState.activeVoiceSession?.conversation === conversation) {
        runtimeState.activeVoiceSession.lastActivityAt = Date.now();
      }

      const responseBody: VoiceTurnResponseBody = {
        reply: markdownToTts(reply),
        continueConversation: !endConversation,
        endConversation,
      };

      res.json(responseBody);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: messageText });
    }
  });
}