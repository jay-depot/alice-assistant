// web-ui.ts — A.L.I.C.E. Web UI plugin entry point.
//
// This file is the glue that wires together the extracted server-side modules.
// All substantive logic lives in lib/ and routes/; this file only orchestrates
// lifecycle hooks, event subscriptions, and the capability offerings.

import type { AlicePlugin } from '../../../lib/types/alice-plugin-interface.js';
import { AgentSystem, ToolCallEvents } from '../../../lib.js';
import { UserConfig } from '../../../lib/user-config.js';
import { createContext } from './context.js';
import type { WebUiContext, PendingToolCallRound } from './context.js';
import {
  registerScript,
  registerStylesheet,
  addExtensionsRoute,
} from './lib/extensions.js';
import {
  resolveTargetChatSession,
  queueAssistantMessageToSession,
  queueAssistantMessage,
  queueAssistantInterruption,
  flushAndEvictAllCachedConversations,
} from './lib/session-manager.js';
import { setupWsBroadcaster, startHeartbeat } from './lib/ws-broadcast.js';
import { createMessageRouter } from './lib/ws-handlers.js';
import { registerChatRoutes } from './routes/http-chat.js';
import { registerStaticRoutes } from './routes/static.js';
import { ChatSession, ChatSessionRound } from './db-schemas/index.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocket, WebSocketServer } from 'ws';
import type { WsToolCallEvent } from './ws-types.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// ── Plugin capability type augmentation ──────────────────────────────────

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'web-ui': {
      express: import('express').Express;
      registerStylesheet: (path: string) => void;
      registerScript: (path: string) => void;
      resolveTargetChatSession: (options: {
        title?: string;
        openNewChatIfNone?: boolean;
        alwaysOpenNewChat?: boolean;
      }) => Promise<number | null>;
      queueAssistantMessageToSession: (
        sessionId: number,
        message: {
          content: string;
          messageKind?: 'chat' | 'notification';
          senderName?: string;
        }
      ) => Promise<void>;
      queueAssistantMessage: (message: {
        content: string;
        title?: string;
        messageKind?: 'chat' | 'notification';
        openNewChatIfNone?: boolean;
        alwaysOpenNewChat?: boolean;
      }) => Promise<number | null>;
      queueAssistantInterruption: (interruption: {
        content: string;
      }) => Promise<number | null>;
    };
  }
}

const webUiPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'web-ui',
    name: 'Web UI Plugin',
    brandColor: '#c32a3a',
    description:
      'Provides the web interface for the assistant, and manages all interactions ' +
      'between the assistant and the web interface.',
    version: 'LATEST',
    dependencies: [
      { id: 'memory', version: 'LATEST' },
      { id: 'rest-serve', version: 'LATEST' },
    ],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { onDatabaseReady, registerDatabaseModels } =
      plugin.request('memory');

    const restServe = plugin.request('rest-serve');
    if (!restServe) {
      throw new Error(
        'web-ui plugin could not access the rest-serve plugin capabilities. Disable web-ui or fix the rest-serve plugin to continue.'
      );
    }

    const userWebInterfaceDir = path.join(
      UserConfig.getConfigPath(),
      'web-interface'
    );
    const userStylePath = path.join(userWebInterfaceDir, 'user-style.css');

    fs.mkdirSync(userWebInterfaceDir, { recursive: true });

    const app = restServe.express;

    // ── Shared context — the extracted modules thread state through this ──
    const ctx: WebUiContext = createContext({
      logger: plugin.logger,
      onDatabaseReady: onDatabaseReady as WebUiContext['onDatabaseReady'],
      app,
    });

    // ── UI extension registration ────────────────────────────────────────

    plugin.offer<'web-ui'>({
      express: app,
      registerStylesheet: (stylesheetPath: string) =>
        registerStylesheet(ctx, stylesheetPath),
      registerScript: (scriptPath: string) => registerScript(ctx, scriptPath),
      resolveTargetChatSession: (options: {
        title?: string;
        openNewChatIfNone?: boolean;
        alwaysOpenNewChat?: boolean;
      }) => resolveTargetChatSession(ctx, options),
      queueAssistantMessageToSession: (
        sessionId: number,
        message: {
          content: string;
          messageKind?: 'chat' | 'notification';
          senderName?: string;
        }
      ) => queueAssistantMessageToSession(ctx, sessionId, message),
      queueAssistantMessage: (message: {
        content: string;
        title?: string;
        messageKind?: 'chat' | 'notification';
        openNewChatIfNone?: boolean;
        alwaysOpenNewChat?: boolean;
      }) => queueAssistantMessage(ctx, message),
      queueAssistantInterruption: (interruption: { content: string }) =>
        queueAssistantInterruption(ctx, interruption),
    });

    // ── DB models + static routes registered at plugin load time ─────────
    registerDatabaseModels([ChatSession, ChatSessionRound]);

    // /user-style.css is registered at plugin-load time (not inside the
    // accept-requests hook) because it has no database dependency.
    ctx.app.get('/user-style.css', (_req, res) => {
      ctx.logger.log(`Serving user style from ${userStylePath}`);
      res.setHeader('Cache-Control', 'no-store');
      if (!fs.existsSync(userStylePath)) {
        res.status(204).end();
        return;
      }
      res.type('text/css');
      const customStyle = fs.readFileSync(userStylePath, 'utf-8');
      res.send(customStyle);
    });

    // ── Agent system callback ────────────────────────────────────────────

    AgentSystem.onUpdate(async update => {
      await queueAssistantMessageToSession(ctx, update.linkedSessionId, {
        content: update.content,
        messageKind: 'chat',
        senderName: update.agentName,
      });
    });

    // ── Tool call event listener (single consolidated listener) ─────────
    // Replaces the two separate onToolCallEvent registrations from the
    // original web-ui.ts. Both the WS broadcast and the DB buffering happen
    // in the same handler.

    ToolCallEvents.onToolCallEvent(async event => {
      const sessionId = event.sessionId;
      if (sessionId === undefined) {
        return;
      }

      const agentName = event.agentInstanceId
        ? AgentSystem.getInstancesBySession(sessionId).find(
            i => i.instanceId === event.agentInstanceId
          )?.agentName
        : undefined;

      // 1. Broadcast over WebSocket
      ctx.broadcastWs({
        type: 'tool_call_event',
        sessionId,
        event: {
          ...event,
          sessionId,
          ...(agentName !== undefined && { agentName }),
        } as unknown as WsToolCallEvent,
      });

      // 2. Buffer completed/error events for DB interleaving
      if (
        event.type !== 'tool_call_completed' &&
        event.type !== 'tool_call_error'
      ) {
        return;
      }

      const content =
        event.type === 'tool_call_completed'
          ? `Called ${event.toolName} with ${JSON.stringify(event.toolArgs)}`
          : `Error calling ${event.toolName}: ${event.error}`;

      const pending: PendingToolCallRound[] =
        ctx.pendingToolCallRounds.get(sessionId) ?? [];
      pending.push({
        role: 'assistant',
        messageKind: 'tool_call',
        content,
        timestamp: new Date(),
        senderName: null,
        toolCallData: {
          callBatchId: event.callBatchId,
          toolName: event.toolName,
          status: event.type === 'tool_call_completed' ? 'completed' : 'error',
          resultSummary: event.resultSummary,
          error: event.error,
          requiresApproval: event.requiresApproval,
          taskAssistantId: event.taskAssistantId,
          agentName,
        },
      });
      ctx.pendingToolCallRounds.set(sessionId, pending);
    });

    // ── Lifecycle hooks ──────────────────────────────────────────────────

    let wss: WebSocketServer | null = null;
    let wsConnections: Set<WebSocket> | null = null;
    let heartbeatInterval: NodeJS.Timeout | null = null;

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      ctx.logger.log(
        'onAssistantAcceptsRequests: Starting web UI route and handler registration.'
      );
      ctx.logger.log(
        `Registering web UI routes on ${UserConfig.getConfig().webInterface.bindToAddress}:${UserConfig.getConfig().webInterface.port}...`
      );

      const orm = await onDatabaseReady(async o => o);
      ctx.setOrm(orm);

      wss = plugin.registerWebSocket('/ws');
      wsConnections = new Set<WebSocket>();

      setupWsBroadcaster(ctx, wsConnections);
      wss.on('connection', createMessageRouter(ctx, wsConnections));
      heartbeatInterval = startHeartbeat(wsConnections);

      registerChatRoutes(ctx);
      addExtensionsRoute(ctx);
      registerStaticRoutes(ctx, currentDir);

      ctx.logger.log(
        'onAssistantAcceptsRequests: Completed web UI route and handler registration.'
      );
    });

    plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
      ctx.logger.log(
        'onAssistantWillStopAcceptingRequests: Starting web UI WS + chat session shutdown.'
      );

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      if (wsConnections) {
        for (const ws of wsConnections) {
          ws.close();
        }
        wsConnections.clear();
      }
      if (wss) {
        await new Promise<void>(resolve => wss!.close(() => resolve()));
      }

      await flushAndEvictAllCachedConversations(ctx);
      ctx.logger.log(
        'onAssistantWillStopAcceptingRequests: Completed web UI WS + chat session shutdown.'
      );
    });
  },
};

export default webUiPlugin;
