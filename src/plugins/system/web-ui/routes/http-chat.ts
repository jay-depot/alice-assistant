// routes/http-chat.ts — HTTP routes for chat session read and compaction.
// Write operations (create/send/end) moved to WebSocket in the protocol
// redesign. These read routes remain for initial page loads and session
// reloads triggered by useSession.loadSession().

import { ChatSession } from '../db-schemas/index.js';
import {
  getOrCreateCachedConversation,
  runSessionOperation,
} from '../lib/session-manager.js';
import {
  serializeRound,
  buildWsSession,
  serializeCompactedContext,
  getActiveAgentsForSession,
} from '../lib/serialization.js';
import type { WebUiContext } from '../context.js';

export function registerChatRoutes(ctx: WebUiContext): void {
  // ── GET /api/chat — session summaries ─────────────────────────────────
  ctx.app.get('/api/chat', async (req, res) => {
    if (!ctx.orm) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }

    const em = ctx.orm.em.fork();

    const sessions = await em.find(ChatSession, {}, { populate: ['rounds'] });

    res.json({
      sessions: sessions.map(session => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        lastMessageAt:
          session.rounds.getItems().length > 0
            ? session.rounds.getItems()[session.rounds.getItems().length - 1]
                .timestamp
            : session.createdAt,
        lastUserMessage:
          session.rounds.getItems().length > 0
            ? session.rounds.getItems()[session.rounds.getItems().length - 1]
                .content
            : '',
        lastAssistantMessage:
          session.rounds.getItems().length > 1
            ? session.rounds.getItems()[session.rounds.getItems().length - 2]
                .content
            : '',
      })),
    });
  });

  // ── GET /api/chat/:id — full session details ──────────────────────────
  ctx.app.get('/api/chat/:id', async (req, res) => {
    const { id } = req.params;

    if (!ctx.orm) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }

    const em = ctx.orm.em.fork();
    const session = await em.findOne(
      ChatSession,
      { id: parseInt(id) },
      { populate: ['rounds'] }
    );
    if (!session) {
      res.status(404).json({ error: 'Chat session not found' });
      return;
    }

    res.json({
      session: {
        id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages: session.rounds
          .getItems()
          .filter(round => round.role !== 'system' && round.role !== 'tool')
          .map(serializeRound),
        activeAgents: getActiveAgentsForSession(session.id),
      },
    });
  });

  // ── POST /api/chat/:id/compact — context compaction ───────────────────
  ctx.app.post('/api/chat/:id/compact', async (req, res) => {
    const { id } = req.params;
    const mode = (req.query.mode as string) || 'normal';
    if (!['normal', 'full', 'clear'].includes(mode)) {
      res.status(400).json({
        error: 'Invalid compaction mode. Use "normal", "full", or "clear".',
      });
      return;
    }

    const parsedId = parseInt(id);

    if (isNaN(parsedId)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }

    if (!ctx.orm) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }

    const em = ctx.orm.em.fork();
    const session = await em.findOne(
      ChatSession,
      { id: parsedId },
      { populate: ['rounds'] }
    );
    if (!session) {
      res.status(404).json({ error: 'Chat session not found' });
      return;
    }

    const result = await runSessionOperation(ctx, parsedId, async () => {
      if (!ctx.orm) throw new Error('Database not initialised');
      const emInner = ctx.orm.em.fork();
      const queuedSession = await emInner.findOne(
        ChatSession,
        { id: parsedId },
        { populate: ['rounds'] }
      );
      if (!queuedSession) {
        throw new Error(`Chat session ${parsedId} not found while compacting.`);
      }

      const conversation = getOrCreateCachedConversation(ctx, queuedSession);
      const didCompact = await conversation.compactContext(
        mode as 'normal' | 'full' | 'clear'
      );

      if (didCompact) {
        // MikroORM's p.json() produces a Brand type; cast through unknown.
        (
          queuedSession as unknown as {
            compactedContext: { role: string; content: string }[] | null;
          }
        ).compactedContext = serializeCompactedContext(
          conversation.compactedContext
        );
        await emInner.flush();
      }

      return {
        didCompact,
        mode,
        wsSession: didCompact
          ? buildWsSession(queuedSession, queuedSession.id)
          : undefined,
      };
    });

    res.json({
      sessionId: parsedId,
      compacted: result.didCompact,
      mode: result.mode,
    });

    if (result.didCompact) {
      ctx.broadcastWs({
        type: 'session_updated',
        sessionId: parsedId,
        session: result.wsSession!,
      });
    }
  });
}
