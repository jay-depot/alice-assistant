// lib/ws-broadcast.ts — WebSocket broadcast and heartbeat for the web-ui plugin.

import type { WebSocket } from 'ws';
import { WebSocket as WsConst } from 'ws';
import { ChatSession } from '../db-schemas/index.js';
import type { WebUiContext } from '../context.js';
import { buildWsSession } from './serialization.js';
import type { WsServerMessage, WsSessionSummary } from '../ws-types.js';

/** Initialise the broadcastWs function on the context.
 *  Must be called inside onAssistantAcceptsRequests, after the WS server
 *  is ready, so wsConnections is populated with live clients. */
export function setupWsBroadcaster(
  ctx: WebUiContext,
  wsConnections: Set<WebSocket>
): void {
  ctx.setBroadcastWs((msg: WsServerMessage): void => {
    const data = JSON.stringify(msg);
    for (const ws of wsConnections) {
      if (ws.readyState === WsConst.OPEN) {
        ws.send(data);
      }
    }
  });
}

/** Query all sessions and push `sessions_list_updated` to every connected
 *  client. Called after any session mutation (create/message/delete). */
export async function broadcastSessionsList(ctx: WebUiContext): Promise<void> {
  if (!ctx.orm) {
    return;
  }

  const listEm = ctx.orm.em.fork();
  const allSessions = await listEm.find(
    ChatSession,
    {},
    { populate: ['rounds'] }
  );
  ctx.broadcastWs({
    type: 'sessions_list_updated',
    sessions: allSessions.map(s => {
      const rounds = s.rounds.getItems();
      return {
        id: s.id,
        title: s.title,
        createdAt: s.createdAt.toISOString(),
        lastMessageAt: (rounds.length > 0
          ? rounds[rounds.length - 1].timestamp
          : s.createdAt
        ).toISOString(),
        lastUserMessage:
          rounds.length > 0 ? rounds[rounds.length - 1].content : '',
        lastAssistantMessage:
          rounds.length > 1 ? rounds[rounds.length - 2].content : '',
      } satisfies WsSessionSummary;
    }),
  });
}

/** Broadcast the canonical session snapshot to every connected viewer so
 *  transient stream/tool-call state can converge back onto persisted session
 *  state without relying on the initiating socket only. */
export function broadcastSessionUpdated(
  ctx: WebUiContext,
  session: ChatSession
): void {
  ctx.broadcastWs({
    type: 'session_updated',
    sessionId: session.id,
    session: buildWsSession(session, session.id),
  });
}

/** Send the current sessions list to a newly-connected WS client so it has
 *  data before the next broadcast arrives. */
export async function sendInitialSessionsList(
  ctx: WebUiContext,
  ws: WebSocket
): Promise<void> {
  if (!ctx.orm) {
    return;
  }

  try {
    const listEm = ctx.orm.em.fork();
    const allSessions = await listEm.find(
      ChatSession,
      {},
      { populate: ['rounds'] }
    );
    if (ws.readyState !== WsConst.OPEN) {
      return;
    }
    const initMsg: WsServerMessage = {
      type: 'sessions_list_updated',
      sessions: allSessions.map(s => {
        const rounds = s.rounds.getItems();
        return {
          id: s.id,
          title: s.title,
          createdAt: s.createdAt.toISOString(),
          lastMessageAt: (rounds.length > 0
            ? rounds[rounds.length - 1].timestamp
            : s.createdAt
          ).toISOString(),
          lastUserMessage:
            rounds.length > 0 ? rounds[rounds.length - 1].content : '',
          lastAssistantMessage:
            rounds.length > 1 ? rounds[rounds.length - 2].content : '',
        } satisfies WsSessionSummary;
      }),
    };
    ws.send(JSON.stringify(initMsg));
  } catch (err) {
    ctx.logger.error(
      '[web-ui] Failed to send initial sessions list over WS:',
      err
    );
  }
}

/** Start a 30 s heartbeat interval. Returns the interval ID so the shutdown
 *  hook can clear it. */
export function startHeartbeat(wsConnections: Set<WebSocket>): NodeJS.Timeout {
  return setInterval(() => {
    for (const ws of [...wsConnections]) {
      if (ws.readyState !== WsConst.OPEN) {
        wsConnections.delete(ws);
        continue;
      }
      ws.send(JSON.stringify({ type: 'ping' } satisfies WsServerMessage));
    }
  }, 30_000);
}
