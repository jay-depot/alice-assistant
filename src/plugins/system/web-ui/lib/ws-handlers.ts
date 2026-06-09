// lib/ws-handlers.ts — WebSocket message handlers for the web-ui plugin.
// Each handler receives a WebUiContext + the WebSocket connection.

import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import {
  TaskAssistants,
  AgentSystem,
  PluginHookInvocations,
  systemLogger,
} from '../../../../lib.js';
import { ChatSession } from '../db-schemas/index.js';
import {
  getOrCreateCachedConversation,
  createEmptyChatSession,
  closeAndEvictCachedConversation,
  evictCachedConversation,
  runSessionOperation,
} from './session-manager.js';
import { persistUnsynchronizedMessages } from './db-persistence.js';
import { buildWsSession } from './serialization.js';
import {
  sendInitialSessionsList,
  broadcastSessionsList,
} from './ws-broadcast.js';
import type { WebUiContext } from '../context.js';
import type { WsClientMessage, WsServerMessage } from '../ws-types.js';

const WS_OPEN = WebSocket.OPEN;

// ── handleSendMessage ────────────────────────────────────────────────────

export async function handleSendMessage(
  ctx: WebUiContext,
  ws: WebSocket,
  msg: WsClientMessage & { type: 'send_message' }
): Promise<void> {
  const { sessionId, content, clientMessageKey } = msg;

  // Acknowledge receipt immediately
  if (ws.readyState === WS_OPEN) {
    ws.send(
      JSON.stringify({
        type: 'message_ack',
        sessionId,
        clientMessageKey,
      } satisfies WsServerMessage)
    );
  }

  try {
    const orm = ctx.orm;
    if (!orm) {
      throw new Error('Database not initialised');
    }

    const em = orm.em.fork();
    const session = await em.findOne(
      ChatSession,
      { id: sessionId },
      { populate: ['rounds'] }
    );
    if (!session) {
      if (ws.readyState === WS_OPEN) {
        ws.send(
          JSON.stringify({
            type: 'message_error',
            sessionId,
            clientMessageKey,
            error: 'Chat session not found',
          } satisfies WsServerMessage)
        );
      }
      return;
    }

    const updatedSession = await runSessionOperation(
      ctx,
      session.id,
      async () => {
        const ormInner = ctx.orm;
        if (!ormInner) throw new Error('Database not initialised');
        const emInner = ormInner.em.fork();
        const queuedSession = await emInner.findOne(
          ChatSession,
          { id: session.id },
          { populate: ['rounds'] }
        );
        if (!queuedSession) {
          throw new Error('Chat session not found while processing message.');
        }

        const activeInstance = TaskAssistants.getActiveInstance(session.id);
        if (activeInstance) {
          await activeInstance.conversation.appendExternalMessage({
            role: 'user',
            content,
          });
          await persistUnsynchronizedMessages(
            ctx,
            emInner,
            queuedSession,
            activeInstance.conversation,
            'chat',
            activeInstance.definition.name
          );
          await activeInstance.conversation.sendUserMessage();
          await persistUnsynchronizedMessages(
            ctx,
            emInner,
            queuedSession,
            activeInstance.conversation,
            'chat',
            activeInstance.definition.name
          );

          const completedResult = TaskAssistants.getAndClearCompletedResult(
            session.id
          );
          if (completedResult) {
            const llmTransaction = getOrCreateCachedConversation(
              ctx,
              queuedSession
            );
            await llmTransaction.appendExternalMessage({
              role: 'system',
              content:
                `Task assistant "${completedResult.taskAssistantName}" has completed.\n\n` +
                completedResult.handbackMessage,
            });
            await llmTransaction.sendUserMessage();
            await persistUnsynchronizedMessages(
              ctx,
              emInner,
              queuedSession,
              llmTransaction,
              'chat'
            );

            const titleSummary = await llmTransaction.maybeRequestTitle();
            queuedSession.title =
              titleSummary ?? queuedSession.title ?? 'New Conversation';
          }

          queuedSession.updatedAt = new Date();
          await emInner.flush();
          return queuedSession;
        }

        const llmTransaction = getOrCreateCachedConversation(
          ctx,
          queuedSession
        );

        const hasPriorUserMessages = queuedSession.rounds
          .getItems()
          .some(round => round.role === 'user');
        if (!hasPriorUserMessages) {
          await PluginHookInvocations.invokeOnUserConversationWillBegin(
            llmTransaction,
            'chat'
          );
        }

        await llmTransaction.appendExternalMessage({
          role: 'user',
          content,
        });
        await persistUnsynchronizedMessages(
          ctx,
          emInner,
          queuedSession,
          llmTransaction,
          'chat'
        );

        const pendingAgentMessages = AgentSystem.getAndClearPendingMessages(
          session.id
        );
        for (const agentMsg of pendingAgentMessages) {
          await llmTransaction.appendExternalMessage({
            role: 'system',
            content: `## ${agentMsg.heading}\n\n${agentMsg.content}`,
          });
        }

        // ── Streaming loop with stream_turn_complete ──────────────────
        let streamDepth = 0;
        while (true) {
          const turn = await llmTransaction.beginStreaming(
            {
              onThinking: delta => {
                ctx.broadcastWs({
                  type: 'stream_thinking',
                  sessionId: session.id,
                  delta,
                });
              },
              onContent: delta => {
                ctx.broadcastWs({
                  type: 'stream_content',
                  sessionId: session.id,
                  delta,
                });
              },
              onToolCalls: toolCalls => {
                ctx.broadcastWs({
                  type: 'stream_tool_calls',
                  sessionId: session.id,
                  toolCalls,
                });
              },
              onError: err => {
                systemLogger.error(
                  'Streaming error in handleSendMessage:',
                  err
                );
                ctx.broadcastWs({
                  type: 'stream_error',
                  sessionId: session.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              },
            },
            { depth: streamDepth }
          );

          await persistUnsynchronizedMessages(
            ctx,
            emInner,
            queuedSession,
            llmTransaction,
            'chat'
          );

          if (turn.toolCalls.length === 0) {
            ctx.broadcastWs({
              type: 'stream_done',
              sessionId: session.id,
              finalContent: turn.content,
              finalReasoning: turn.thinking || null,
            });
            break;
          }

          // Signal turn boundary so the client wraps this turn's
          // reasoning in a collapsible block, links it to the
          // tool call batch that follows, and prepares the next
          // turn slot.
          const turnBatchId = randomUUID();

          await llmTransaction.executeToolCalls(
            turn.toolCalls,
            streamDepth,
            turnBatchId
          );

          // Signal turn boundary AFTER tool execution so the
          // client already has the batch data when it renders.
          ctx.broadcastWs({
            type: 'stream_turn_complete',
            sessionId: session.id,
            turnIndex: streamDepth,
            hasToolCalls: true,
            callBatchId: turnBatchId,
          });

          streamDepth++;
        }

        const titleSummary = await llmTransaction.maybeRequestTitle();
        queuedSession.title =
          titleSummary ?? queuedSession.title ?? 'New Conversation';

        await emInner.flush();
        return queuedSession;
      }
    );

    // Canonical session update to the initiating client
    if (ws.readyState === WS_OPEN) {
      ws.send(
        JSON.stringify({
          type: 'session_updated',
          sessionId: updatedSession.id,
          session: buildWsSession(updatedSession, updatedSession.id),
        } satisfies WsServerMessage)
      );
    }
    void broadcastSessionsList(ctx);
  } catch (error) {
    systemLogger.error('handleSendMessage failed:', error);
    if (ws.readyState === WS_OPEN) {
      ws.send(
        JSON.stringify({
          type: 'message_error',
          sessionId,
          clientMessageKey,
          error: error instanceof Error ? error.message : String(error),
        } satisfies WsServerMessage)
      );
    }
  }
}

// ── handleCreateSession ──────────────────────────────────────────────────

export async function handleCreateSession(
  ctx: WebUiContext,
  ws: WebSocket
): Promise<void> {
  try {
    const sessionId = await createEmptyChatSession(ctx);
    const orm = ctx.orm;
    if (!orm) throw new Error('Database not initialised');
    const em = orm.em.fork();
    const session = await em.findOne(
      ChatSession,
      { id: sessionId },
      { populate: ['rounds'] }
    );
    if (!session) {
      throw new Error('Created session disappeared.');
    }

    const conversation = getOrCreateCachedConversation(ctx, session);
    await conversation.sendUserMessage();
    await persistUnsynchronizedMessages(ctx, em, session, conversation, 'chat');

    const wsSession = buildWsSession(session, sessionId);
    if (ws.readyState === WS_OPEN) {
      ws.send(
        JSON.stringify({
          type: 'session_created',
          session: wsSession,
        } satisfies WsServerMessage)
      );
      ws.send(
        JSON.stringify({
          type: 'session_updated',
          sessionId,
          session: wsSession,
        } satisfies WsServerMessage)
      );
    }
    void broadcastSessionsList(ctx);
  } catch (error) {
    systemLogger.error('handleCreateSession failed:', error);
    if (ws.readyState === WS_OPEN) {
      ws.send(
        JSON.stringify({
          type: 'message_error',
          sessionId: 0,
          clientMessageKey: '',
          error: error instanceof Error ? error.message : String(error),
        } satisfies WsServerMessage)
      );
    }
  }
}

// ── handleEndSession ─────────────────────────────────────────────────────

export async function handleEndSession(
  ctx: WebUiContext,
  ws: WebSocket,
  msg: WsClientMessage & { type: 'end_session' }
): Promise<void> {
  const { sessionId } = msg;

  try {
    const orm = ctx.orm;
    if (!orm) throw new Error('Database not initialised');
    const em = orm.em.fork();
    const session = await em.findOne(
      ChatSession,
      { id: sessionId },
      { populate: ['rounds'] }
    );
    if (!session) {
      if (ws.readyState === WS_OPEN) {
        ws.send(
          JSON.stringify({
            type: 'session_ended',
            sessionId,
          } satisfies WsServerMessage)
        );
      }
      return;
    }

    await runSessionOperation(ctx, sessionId, async () => {
      const ormInner = ctx.orm;
      if (!ormInner) throw new Error('Database not initialised');
      const emInner = ormInner.em.fork();
      const queuedSession = await emInner.findOne(
        ChatSession,
        { id: sessionId },
        { populate: ['rounds'] }
      );
      if (!queuedSession) {
        throw new Error(`Chat session ${sessionId} not found while deleting.`);
      }

      const userMessages = queuedSession.rounds
        .getItems()
        .filter(round => round.role === 'user');
      if (userMessages.length > 0) {
        ctx.logger.log(
          `Requesting conversation summary for chat session ${sessionId} before deletion...`
        );
        getOrCreateCachedConversation(ctx, queuedSession);
        await closeAndEvictCachedConversation(ctx, sessionId);
      } else {
        evictCachedConversation(ctx, sessionId);
      }

      queuedSession.rounds.removeAll();
      emInner.remove(queuedSession);
      await emInner.flush();
    });

    if (ws.readyState === WS_OPEN) {
      ws.send(
        JSON.stringify({
          type: 'session_ended',
          sessionId,
        } satisfies WsServerMessage)
      );
    }
    ctx.logger.log(`Chat session ${sessionId} deleted successfully.`);
    void broadcastSessionsList(ctx);
  } catch (error) {
    systemLogger.error('handleEndSession failed:', error);
  }
}

// ── Message router ───────────────────────────────────────────────────────
// Wraps wss.on('connection', ...) with the full lifecycle setup and the
// switch-based client message dispatcher.

export function createMessageRouter(
  ctx: WebUiContext,
  wsConnections: Set<WebSocket>
): (ws: WebSocket) => void {
  return (ws: WebSocket) => {
    wsConnections.add(ws);

    // ── Client message router ───────────────────────────────────────────
    ws.on('message', (data: Buffer) => {
      let msg: WsClientMessage;
      try {
        msg = JSON.parse(data.toString()) as WsClientMessage;
      } catch {
        return; // malformed — ignore
      }

      switch (msg.type) {
        case 'send_message':
          void handleSendMessage(ctx, ws, msg);
          break;
        case 'create_session':
          void handleCreateSession(ctx, ws);
          break;
        case 'end_session':
          void handleEndSession(ctx, ws, msg);
          break;
        case 'pong':
          // heartbeat response — no action needed
          break;
        default:
          ctx.logger.warn(
            `[web-ui] Unexpected WS client message type: ${(msg as { type: string }).type}`
          );
      }
    });

    ws.on('close', () => wsConnections.delete(ws));
    ws.on('error', () => wsConnections.delete(ws));

    // Send current sessions list immediately so the client has data before
    // any broadcast arrives — covers the page-reload case and the deep-dive
    // agent session-reload regression.
    void sendInitialSessionsList(ctx, ws);
  };
}
