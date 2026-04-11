import type { Express, Request, Response, NextFunction } from 'express';
import { type Conversation, startConversation } from '../../../lib.js';
import { PluginHookInvocations } from '../../../lib/plugin-hooks.js';
import { extractVoiceAccessToken, isVoiceAccessTokenValid } from './auth.js';
import { isManagedVoiceClientRunning, type ManagedVoiceClientState } from './managed-client.js';

type ActiveVoiceSession = {
  conversation: Conversation;
  lastActivityAt: number;
};

export type VoicePluginRuntimeState = {
  accessToken: string | null;
  managedClientState: ManagedVoiceClientState;
  activeVoiceSession: ActiveVoiceSession | null;
  sessionIdleTimeoutMs: number;
};

type VoiceTurnRequestBody = {
  message?: string;
};

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

export async function closeActiveVoiceSession(runtimeState: VoicePluginRuntimeState): Promise<void> {
  if (!runtimeState.activeVoiceSession) {
    return;
  }

  const { conversation } = runtimeState.activeVoiceSession;
  runtimeState.activeVoiceSession = null;

  await PluginHookInvocations.invokeOnUserConversationWillEnd(conversation, 'voice');
  await conversation.closeConversation();
}

async function getOrCreateActiveVoiceConversation(runtimeState: VoicePluginRuntimeState): Promise<Conversation> {
  if (hasActiveVoiceSessionExpired(runtimeState)) {
    await closeActiveVoiceSession(runtimeState);
  }

  if (runtimeState.activeVoiceSession) {
    runtimeState.activeVoiceSession.lastActivityAt = Date.now();
    return runtimeState.activeVoiceSession.conversation;
  }

  const conversation = startConversation('voice');
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
    res.json({
      ok: true,
      hasAccessToken: !!runtimeState.accessToken,
      managedClientRunning: isManagedVoiceClientRunning(runtimeState.managedClientState),
      hasActiveVoiceSession: !!runtimeState.activeVoiceSession,
      sessionIdleTimeoutMs: runtimeState.sessionIdleTimeoutMs,
    });
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