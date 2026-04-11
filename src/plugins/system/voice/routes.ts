import type { Express, Request, Response, NextFunction } from 'express';
import { type Conversation, startConversation } from '../../../lib.js';
import { PluginHookInvocations } from '../../../lib/plugin-hooks.js';
import { extractVoiceAccessToken, isVoiceAccessTokenValid } from './auth.js';
import { isManagedVoiceClientRunning, type ManagedVoiceClientState } from './managed-client.js';

type ActiveVoiceSession = {
  conversation: Conversation;
  lastActivityAt: number;
};

type DeferredVoiceSessionClose = {
  conversation: Conversation;
  timer: ReturnType<typeof setTimeout> | null;
  closePromise: Promise<void> | null;
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
};

type VoiceTurnRequestBody = {
  message?: string;
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

function finalizeDeferredVoiceSessionClose(
  runtimeState: VoicePluginRuntimeState,
  deferredClose: DeferredVoiceSessionClose,
): Promise<void> {
  if (deferredClose.closePromise) {
    return deferredClose.closePromise;
  }

  if (deferredClose.timer) {
    clearTimeout(deferredClose.timer);
    deferredClose.timer = null;
  }

  deferredClose.closePromise = (async () => {
    console.log('voice plugin: finalizing inactive voice conversation.');
    await PluginHookInvocations.invokeOnUserConversationWillEnd(deferredClose.conversation, 'voice');
    await deferredClose.conversation.closeConversation();
  })().catch((error) => {
    console.error('voice plugin: deferred voice session cleanup failed:', error);
  }).finally(() => {
    runtimeState.pendingVoiceSessionCloses.delete(deferredClose);
  });

  return deferredClose.closePromise;
}

function scheduleDeferredVoiceSessionClose(runtimeState: VoicePluginRuntimeState, conversation: Conversation): void {
  const deferredClose: DeferredVoiceSessionClose = {
    conversation,
    timer: null,
    closePromise: null,
  };

  runtimeState.pendingVoiceSessionCloses.add(deferredClose);

  if (runtimeState.deferredSessionCloseDelayMs <= 0) {
    console.log('voice plugin: expiring voice session and finalizing immediately in the background.');
    void finalizeDeferredVoiceSessionClose(runtimeState, deferredClose);
    return;
  }

  console.log(`voice plugin: scheduling voice session cleanup in ${runtimeState.deferredSessionCloseDelayMs}ms.`);
  deferredClose.timer = setTimeout(() => {
    void finalizeDeferredVoiceSessionClose(runtimeState, deferredClose);
  }, runtimeState.deferredSessionCloseDelayMs);
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
    timer: null,
    closePromise: null,
  };

  runtimeState.pendingVoiceSessionCloses.add(deferredClose);
  await finalizeDeferredVoiceSessionClose(runtimeState, deferredClose);
}

async function getOrCreateActiveVoiceConversation(runtimeState: VoicePluginRuntimeState): Promise<Conversation> {
  if (hasActiveVoiceSessionExpired(runtimeState)) {
    console.log('voice plugin: active voice session expired, scheduling closure and starting a fresh conversation.');
    await closeActiveVoiceSession(runtimeState, { deferFinalization: true });
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
      debug: {
        session: {
          activeSessionAgeMs: runtimeState.activeVoiceSession
            ? Date.now() - runtimeState.activeVoiceSession.lastActivityAt
            : null,
          deferredCloseState: {
            pendingCount: pendingDeferredCloses.length,
            scheduledCount: pendingDeferredCloses.filter((deferredClose) => deferredClose.timer !== null).length,
            inFlightCount: pendingDeferredCloses.filter((deferredClose) => deferredClose.closePromise !== null).length,
          },
        },
        capture: runtimeState.captureDebugConfig,
        lastCapture: runtimeState.lastCaptureDebug,
      },
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

  app.post('/api/voice/turn', requireToken, async (req, res) => {
    const body = (req.body ?? {}) as VoiceTurnRequestBody;
    const message = body.message?.trim();

    if (!message) {
      res.status(400).json({ error: 'Voice turn request must include a non-empty message.' });
      return;
    }

    try {
      const conversation = await getOrCreateActiveVoiceConversation(runtimeState);
      const reply = await conversation.sendUserMessage(message);
      if (runtimeState.activeVoiceSession) {
        runtimeState.activeVoiceSession.lastActivityAt = Date.now();
      }

      res.json({
        reply,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: messageText });
    }
  });
}