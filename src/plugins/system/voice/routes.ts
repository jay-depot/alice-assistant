import type { Express, Request, Response, NextFunction } from 'express';
import { startConversation } from '../../../lib.js';
import { extractVoiceAccessToken, isVoiceAccessTokenValid } from './auth.js';
import { isManagedVoiceClientRunning, type ManagedVoiceClientState } from './managed-client.js';

type VoicePluginRuntimeState = {
  accessToken: string | null;
  managedClientState: ManagedVoiceClientState;
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

export function registerVoiceRoutes(app: Express, runtimeState: VoicePluginRuntimeState): void {
  const requireToken = requireVoiceAccessToken(runtimeState);

  app.get('/api/voice/health', requireToken, (_req, res) => {
    res.json({
      ok: true,
      hasAccessToken: !!runtimeState.accessToken,
      managedClientRunning: isManagedVoiceClientRunning(runtimeState.managedClientState),
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
      const conversation = startConversation('voice');
      const reply = await conversation.sendUserMessage(message);

      res.json({
        reply,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: messageText });
    }
  });
}