import {
  AlicePlugin,
  AliceUiScriptRegistration,
  Conversation,
  Message,
  startConversation,
  TaskAssistants,
  AgentSystem,
  ToolCallEvents,
} from '../../../lib.js';
import { WebSocket } from 'ws';
import type {
  WsServerMessage,
  WsToolCallEvent,
  WsSession,
  WsMessage,
} from './ws-types.js';
import { Express, static as serveStatic } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import type { MikroORM } from '@mikro-orm/sqlite';
import { UserConfig } from '../../../lib/user-config.js';
import { ChatSession, ChatSessionRound } from './db-schemas/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
type EntityManager = MikroORM['em'];

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'web-ui': {
      express: Express;
      registerStylesheet: (path: string) => void;
      /**
       * Registers a script to be served and loaded by the web UI. The script should implement an `onAliceUIReady()`
       * function where it can register its components and routes.
       */
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
    ], // probably no plugins should depend on this one, since it's so core to the assistant's functionality. Should we enforce that somehow?
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { onDatabaseReady } = plugin.request('memory');

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
    type RegisteredUiExtension = AliceUiScriptRegistration & {
      groupKey: string;
    };

    const registeredScripts: RegisteredUiExtension[] = [];
    const registeredScriptPaths = new Set<string>();
    const registeredStylesheetPaths = new Set<string>();
    const stylesheetUrlsByGroup = new Map<string, string[]>();
    const sessionOperationQueues = new Map<number, Promise<void>>();
    const cachedChatConversations = new Map<number, Conversation>();

    // Late-bound WebSocket broadcaster — assigned once the WS server is ready in
    // onAssistantAcceptsRequests. A no-op until then (no clients can connect anyway).
    let broadcastWs: (msg: WsServerMessage) => void = () => {};

    // Buffer for tool call rounds collected during sendUserMessage() so they can be flushed    // into the DB *before* the final assistant response — ensuring correct display order.
    type PendingToolCallRound = {
      role: 'assistant';
      messageKind: 'tool_call';
      content: string;
      timestamp: Date;
      senderName: null;
      toolCallData: {
        callBatchId: string;
        toolName: string;
        status: 'completed' | 'error';
        resultSummary?: string;
        error?: string;
        requiresApproval?: boolean;
        taskAssistantId?: string;
        agentName?: string;
      };
    };
    const pendingToolCallRounds = new Map<number, PendingToolCallRound[]>();

    const restoreConversationMessages = (
      rounds: ChatSessionRound[]
    ): Message[] => {
      return rounds
        .filter(round => round.messageKind !== 'tool_call')
        .map(round => ({
          role: round.role,
          content: round.content,
        }));
    };

    const serializeCompactedContext = (
      messages: Message[] | undefined
    ): { role: string; content: string }[] | null => {
      if (!messages || messages.length === 0) {
        return null;
      }
      return messages.map(m => ({ role: m.role, content: m.content }));
    };

    const restoreCompactedContext = (json: unknown): Message[] | undefined => {
      if (!json) {
        return undefined;
      }
      try {
        // MikroORM's p.json() column may return an already-parsed array
        // or a string (legacy). Handle both.
        const parsed = Array.isArray(json) ? json : JSON.parse(String(json));
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return undefined;
        }
        return parsed as Message[];
      } catch {
        return undefined;
      }
    };

    const buildWsSession = (
      session: ChatSession,
      sessionId: number
    ): WsSession => ({
      id: sessionId,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messages: session.rounds
        .getItems()
        .filter(round => round.role !== 'system')
        .map(serializeRound) as WsMessage[],
      activeAgents: getActiveAgentsForSession(sessionId).map(agent => ({
        ...agent,
        startedAt:
          agent.startedAt instanceof Date
            ? agent.startedAt.toISOString()
            : String(agent.startedAt),
      })),
      hasCompactedContext:
        session.compactedContext != null &&
        session.compactedContext !== undefined,
    });

    const serializeRound = (round: ChatSessionRound) => ({
      role: round.role,
      messageKind: round.messageKind,
      content: round.content,
      timestamp:
        round.timestamp instanceof Date
          ? round.timestamp.toISOString()
          : String(round.timestamp),
      senderName: round.senderName,
      toolCallData: round.toolCallData,
    });

    const getActiveAgentsForSession = (sessionId: number) =>
      AgentSystem.getInstancesBySession(sessionId).map(instance => ({
        instanceId: instance.instanceId,
        agentId: instance.agentId,
        agentName: instance.agentName,
        status: instance.status,
        startedAt: instance.startedAt,
        pendingMessageCount: instance.pendingMessages.length,
      }));

    const evictCachedConversation = (sessionId: number): void => {
      cachedChatConversations.delete(sessionId);
    };

    const getOrCreateCachedConversation = (
      session: ChatSession
    ): Conversation => {
      const cachedConversation = cachedChatConversations.get(session.id);
      if (cachedConversation) {
        return cachedConversation;
      }

      const conversation = startConversation('chat', { sessionId: session.id });
      conversation.restoreContext(
        restoreConversationMessages(session.rounds.getItems()),
        restoreCompactedContext(session.compactedContext)
      );
      cachedChatConversations.set(session.id, conversation);
      return conversation;
    };

    const persistUnsynchronizedMessages = async (
      em: EntityManager,
      session: ChatSession,
      conversation: Conversation,
      assistantMessageKind: 'chat' | 'notification' = 'chat',
      senderName?: string
    ): Promise<void> => {
      const unsynchronizedMessages = conversation.getUnsynchronizedMessages();
      const persistableMessages = unsynchronizedMessages.filter(
        message => message.role !== 'system'
      );

      if (persistableMessages.length === 0) {
        if (unsynchronizedMessages.length > 0) {
          conversation.markUnsynchronizedMessagesSynchronized();
        }
        return;
      }

      persistableMessages.forEach(message => {
        const round = em.create(ChatSessionRound, {
          chatSession: session,
          role: message.role as 'user' | 'assistant',
          messageKind:
            message.role === 'assistant' ? assistantMessageKind : 'chat',
          timestamp: new Date(),
          content: message.content,
          senderName:
            message.role === 'assistant' ? (senderName ?? null) : null,
        });

        session.rounds.add(round);
        session.updatedAt = round.timestamp;

        // After persisting an intermediate assistant message that triggered tool
        // calls, flush the buffered tool call rows immediately so they receive
        // DB IDs after this message but before the final response message.
        if (
          message.role === 'assistant' &&
          message.tool_calls &&
          message.tool_calls.length > 0
        ) {
          const pending = pendingToolCallRounds.get(session.id);
          if (pending && pending.length > 0) {
            pendingToolCallRounds.delete(session.id);
            for (const entry of pending) {
              const toolRound = em.create(ChatSessionRound, {
                chatSession: session,
                ...entry,
              });
              session.rounds.add(toolRound);
              session.updatedAt = toolRound.timestamp;
            }
          }
        }
      });

      await em.flush();
      conversation.markUnsynchronizedMessagesSynchronized();

      // Persist the compacted context so sessions can be restored with their
      // compaction state intact — avoids re-compacting from scratch on reload.
      // MikroORM's p.json() produces a Brand type; cast through unknown.
      (
        session as unknown as {
          compactedContext: { role: string; content: string }[] | null;
        }
      ).compactedContext = serializeCompactedContext(
        conversation.compactedContext
      );
      await em.flush();
    };

    // Flush buffered tool call rounds into the DB before conversation messages so that
    // tool calls appear before the final assistant response in the persisted order.
    const flushPendingToolCallRounds = (
      em: EntityManager,
      session: ChatSession
    ): void => {
      const pending = pendingToolCallRounds.get(session.id);
      if (!pending || pending.length === 0) {
        return;
      }
      pendingToolCallRounds.delete(session.id);

      for (const entry of pending) {
        const round = em.create(ChatSessionRound, {
          chatSession: session,
          ...entry,
        });
        session.rounds.add(round);
        session.updatedAt = round.timestamp;
      }
    };

    const flushCachedConversation = async (
      sessionId: number,
      assistantMessageKind: 'chat' | 'notification' = 'chat'
    ): Promise<boolean> => {
      const conversation = cachedChatConversations.get(sessionId);
      if (!conversation) {
        return false;
      }

      const orm = await onDatabaseReady(async databaseOrm => databaseOrm);
      const em = orm.em.fork();
      const session = await em.findOne(
        ChatSession,
        { id: sessionId },
        { populate: ['rounds'] }
      );
      if (!session) {
        evictCachedConversation(sessionId);
        return false;
      }

      await persistUnsynchronizedMessages(
        em,
        session,
        conversation,
        assistantMessageKind
      );
      return true;
    };

    const closeAndEvictCachedConversation = async (
      sessionId: number
    ): Promise<void> => {
      const conversation = cachedChatConversations.get(sessionId);
      if (!conversation) {
        return;
      }

      await flushCachedConversation(sessionId);
      await conversation.closeConversation();
      evictCachedConversation(sessionId);
    };

    const flushAndEvictAllCachedConversations = async (): Promise<void> => {
      const cachedSessionIds = [...cachedChatConversations.keys()];
      for (const sessionId of cachedSessionIds) {
        await flushCachedConversation(sessionId);
        evictCachedConversation(sessionId);
      }
    };

    const createEmptyChatSession = async (title?: string): Promise<number> => {
      const orm = await onDatabaseReady(async databaseOrm => databaseOrm);
      const em = orm.em.fork();
      const createdAt = new Date();
      const conversationRecord = em.create(ChatSession, {
        title: title || 'New Conversation',
        rounds: [],
        createdAt,
        updatedAt: createdAt,
      });
      await em.flush();

      const conversation = startConversation('chat', {
        sessionId: conversationRecord.id,
      });
      cachedChatConversations.set(conversationRecord.id, conversation);

      return conversationRecord.id;
    };

    const queueAssistantMessageToSession = async (
      sessionId: number,
      message: {
        content: string;
        messageKind?: 'chat' | 'notification';
        senderName?: string;
      }
    ): Promise<void> => {
      await runSessionOperation(sessionId, async () => {
        const orm = await onDatabaseReady(async databaseOrm => databaseOrm);
        const em = orm.em.fork();
        const session = await em.findOne(
          ChatSession,
          { id: sessionId },
          { populate: ['rounds'] }
        );
        if (!session) {
          throw new Error(
            `Chat session ${sessionId} disappeared before assistant message delivery.`
          );
        }

        const conversation = getOrCreateCachedConversation(session);
        // Flush any buffered agent tool call rounds before the agent's message so
        // they are persisted with lower DB IDs (i.e. appear above it in the chat).
        flushPendingToolCallRounds(em, session);
        await conversation.appendExternalMessage({
          role: 'assistant',
          content: message.content,
        });
        await persistUnsynchronizedMessages(
          em,
          session,
          conversation,
          message.messageKind || 'chat',
          message.senderName
        );
        broadcastWs({
          type: 'session_updated',
          sessionId: session.id,
          session: buildWsSession(session, session.id),
        });
      });
    };

    const resolveTargetChatSession = async (options: {
      title?: string;
      openNewChatIfNone?: boolean;
      alwaysOpenNewChat?: boolean;
    }): Promise<number | null> => {
      if (options.alwaysOpenNewChat) {
        return createEmptyChatSession(options.title);
      }

      const orm = await onDatabaseReady(async databaseOrm => databaseOrm);
      const sessionLookupEm = orm.em.fork();
      const mostRecentSession = await sessionLookupEm.findOne(
        ChatSession,
        {},
        {
          orderBy: { updatedAt: 'DESC', id: 'DESC' },
        }
      );

      if (!mostRecentSession) {
        if (!options.openNewChatIfNone) {
          return null;
        }

        return createEmptyChatSession(options.title);
      }

      return mostRecentSession.id;
    };

    const runSessionOperation = async <T>(
      sessionId: number,
      operation: () => Promise<T>
    ): Promise<T> => {
      const previousOperation =
        sessionOperationQueues.get(sessionId) ?? Promise.resolve();
      let releaseQueue: () => void;
      const queueSlot = new Promise<void>(resolve => {
        releaseQueue = resolve;
      });

      const queuedOperation = previousOperation
        .catch(() => undefined)
        .then(() => queueSlot);

      sessionOperationQueues.set(sessionId, queuedOperation);

      await previousOperation.catch(() => undefined);

      try {
        return await operation();
      } finally {
        releaseQueue!();
        if (sessionOperationQueues.get(sessionId) === queuedOperation) {
          sessionOperationQueues.delete(sessionId);
        }
      }
    };

    const queueAssistantMessage = async (message: {
      content: string;
      title?: string;
      messageKind?: 'chat' | 'notification';
      openNewChatIfNone?: boolean;
      alwaysOpenNewChat?: boolean;
    }): Promise<number | null> => {
      const sessionId = await resolveTargetChatSession({
        title: message.title,
        openNewChatIfNone: message.openNewChatIfNone,
        alwaysOpenNewChat: message.alwaysOpenNewChat,
      });

      if (sessionId === null) {
        return null;
      }

      await queueAssistantMessageToSession(sessionId, {
        content: message.content,
        messageKind: message.messageKind || 'chat',
      });

      return sessionId;
    };

    const queueAssistantInterruption = async (interruption: {
      content: string;
    }): Promise<number | null> => {
      return queueAssistantMessage({
        content: interruption.content,
        messageKind: 'notification',
        openNewChatIfNone: false,
      });
    };

    AgentSystem.onUpdate(async update => {
      await queueAssistantMessageToSession(update.linkedSessionId, {
        content: update.content,
        messageKind: 'chat',
        senderName: update.agentName,
      });
    });

    // Subscribe to tool call events and broadcast over WebSocket
    ToolCallEvents.onToolCallEvent(async event => {
      const sessionId = event.sessionId;
      if (sessionId === undefined) {
        return;
      }

      // Enrich the event with agentName so the client can apply agent-specific
      // CSS classes to in-flight tool call batches without a separate lookup.
      const agentName = event.agentInstanceId
        ? AgentSystem.getInstancesBySession(sessionId).find(
            i => i.instanceId === event.agentInstanceId
          )?.agentName
        : undefined;

      broadcastWs({
        type: 'tool_call_event',
        sessionId,
        event: {
          ...event,
          sessionId,
          ...(agentName !== undefined && { agentName }),
        } as unknown as WsToolCallEvent,
      });
    });

    // Buffer tool_call_completed and tool_call_error events so they can be
    // interleaved into the DB at the correct position — after the intermediate
    // assistant message that triggered them but before the final response.
    // Actual insertion happens inside persistUnsynchronizedMessages.
    ToolCallEvents.onToolCallEvent(async event => {
      const sessionId = event.sessionId;
      if (sessionId === undefined) {
        return;
      }

      // Only persist completed and error events (started is transient)
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

      const agentName = event.agentInstanceId
        ? AgentSystem.getInstancesBySession(sessionId).find(
            i => i.instanceId === event.agentInstanceId
          )?.agentName
        : undefined;

      const pending = pendingToolCallRounds.get(sessionId) ?? [];
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
      pendingToolCallRounds.set(sessionId, pending);
    });

    const registerScript = (scriptPath: string): void => {
      const resolvedPath = path.resolve(scriptPath);
      const groupKey = path.dirname(resolvedPath);

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(
          `web-ui plugin: registerScript could not find file: ${resolvedPath}`
        );
      }

      if (!fs.statSync(resolvedPath).isFile()) {
        throw new Error(
          `web-ui plugin: registerScript expected a file path, got: ${resolvedPath}`
        );
      }

      if (registeredScriptPaths.has(resolvedPath)) {
        return;
      }

      const scriptId = createHash('sha1')
        .update(resolvedPath)
        .digest('hex')
        .slice(0, 12);
      const safeFileName = path
        .basename(resolvedPath)
        .replace(/[^a-zA-Z0-9._-]/g, '-');
      const scriptUrl = `/plugin-scripts/${scriptId}-${safeFileName}`;

      registeredScriptPaths.add(resolvedPath);
      registeredScripts.push({
        id: scriptId,
        scriptUrl,
        styleUrls: [...(stylesheetUrlsByGroup.get(groupKey) ?? [])],
        groupKey,
      });

      app.get(scriptUrl, (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.type('application/javascript');
        res.sendFile(resolvedPath);
      });

      plugin.logger.log(
        `Registered web UI client script ${resolvedPath} at ${scriptUrl}`
      );
    };

    const registerStylesheet = (stylesheetPath: string): void => {
      const resolvedPath = path.resolve(stylesheetPath);
      const groupKey = path.dirname(resolvedPath);

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(
          `web-ui plugin: registerStylesheet could not find file: ${resolvedPath}`
        );
      }

      if (!fs.statSync(resolvedPath).isFile()) {
        throw new Error(
          `web-ui plugin: registerStylesheet expected a file path, got: ${resolvedPath}`
        );
      }

      if (registeredStylesheetPaths.has(resolvedPath)) {
        return;
      }

      const stylesheetId = createHash('sha1')
        .update(resolvedPath)
        .digest('hex')
        .slice(0, 12);
      const safeFileName = path
        .basename(resolvedPath)
        .replace(/[^a-zA-Z0-9._-]/g, '-');
      const styleUrl = `/plugin-styles/${stylesheetId}-${safeFileName}`;

      registeredStylesheetPaths.add(resolvedPath);
      stylesheetUrlsByGroup.set(groupKey, [
        ...(stylesheetUrlsByGroup.get(groupKey) ?? []),
        styleUrl,
      ]);

      registeredScripts.forEach(registration => {
        if (
          registration.groupKey === groupKey &&
          !registration.styleUrls.includes(styleUrl)
        ) {
          registration.styleUrls.push(styleUrl);
        }
      });

      app.get(styleUrl, (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.type('text/css');
        res.sendFile(resolvedPath);
      });

      plugin.logger.log(
        `Registered web UI stylesheet ${resolvedPath} at ${styleUrl}`
      );
    };

    app.get('/user-style.css', (_req, res) => {
      plugin.logger.log(`Serving user style from ${userStylePath}`);
      res.setHeader('Cache-Control', 'no-store');
      if (!fs.existsSync(userStylePath)) {
        res.status(204).end();
        return;
      }

      res.type('text/css');
      const customStyle = fs.readFileSync(userStylePath, 'utf-8');

      res.send(customStyle);
    });

    app.use(
      serveStatic(path.join(currentDir, 'client'), { fallthrough: true })
    );

    plugin.offer<'web-ui'>({
      express: app,
      registerStylesheet,
      registerScript,
      resolveTargetChatSession,
      queueAssistantMessageToSession,
      queueAssistantMessage,
      queueAssistantInterruption,
    });

    const { registerDatabaseModels } = plugin.request('memory');
    registerDatabaseModels([ChatSession, ChatSessionRound]);

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      plugin.logger.log(
        'onAssistantAcceptsRequests: Starting web UI route and handler registration.'
      );
      // TODO: Organize this crap into files.
      plugin.logger.log(
        `Registering web UI routes on ${UserConfig.getConfig().webInterface.bindToAddress}:${UserConfig.getConfig().webInterface.port}...`
      );
      const orm = await onDatabaseReady(async orm => orm);

      // ── WebSocket server ────────────────────────────────────────────────────
      // Use the plugin engine's registerWebSocket() to get a noServer-mode
      // WebSocketServer with automatic upgrade routing and cleanup.
      const wss = plugin.registerWebSocket('/ws');
      const wsConnections = new Set<WebSocket>();

      broadcastWs = (msg: WsServerMessage): void => {
        const data = JSON.stringify(msg);
        for (const ws of wsConnections) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        }
      };

      const broadcastSessionsList = async (): Promise<void> => {
        const listEm = orm.em.fork();
        const allSessions = await listEm.find(
          ChatSession,
          {},
          { populate: ['rounds'] }
        );
        broadcastWs({
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
            };
          }),
        });
      };

      wss.on('connection', ws => {
        wsConnections.add(ws);

        ws.on('message', (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString()) as { type: string };
            if (msg.type !== 'pong') {
              plugin.logger.warn(
                `[web-ui] Unexpected WS client message type: ${msg.type}`
              );
            }
          } catch {
            // malformed message — ignore
          }
        });

        ws.on('close', () => wsConnections.delete(ws));
        ws.on('error', () => wsConnections.delete(ws));

        // Send current sessions list immediately so the client has data before
        // any broadcast arrives — covers the page-reload case and the deep-dive
        // agent session-reload regression.
        void (async () => {
          try {
            const listEm = orm.em.fork();
            const allSessions = await listEm.find(
              ChatSession,
              {},
              { populate: ['rounds'] }
            );
            if (ws.readyState !== WebSocket.OPEN) {
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
                };
              }),
            };
            ws.send(JSON.stringify(initMsg));
          } catch (err) {
            plugin.logger.error(
              '[web-ui] Failed to send initial sessions list over WS:',
              err
            );
          }
        })();
      });

      // Heartbeat: ping all connections every 30 s and prune dead ones.
      const heartbeatInterval = setInterval(() => {
        for (const ws of [...wsConnections]) {
          if (ws.readyState !== WebSocket.OPEN) {
            wsConnections.delete(ws);
            continue;
          }
          ws.send(JSON.stringify({ type: 'ping' } satisfies WsServerMessage));
        }
      }, 30_000);

      app.post('/api/chat', async (req, res) => {
        // Creates a new chat sessions with the assistant. Sends an initial "You've been
        // activated through an alternative text-based interface. Greet the user" prompt
        // and returns the answer to it.

        const em = orm.em.fork();
        const now = new Date();
        const conversationRecord = em.create(ChatSession, {
          title: 'New Conversation',
          rounds: [],
          createdAt: now,
          updatedAt: now,
        });
        await em.flush();

        const conversation = startConversation('chat', {
          sessionId: conversationRecord.id,
        });
        cachedChatConversations.set(conversationRecord.id, conversation);
        await conversation.sendUserMessage();
        await persistUnsynchronizedMessages(
          em,
          conversationRecord,
          conversation,
          'chat'
        );

        res.json({
          session: {
            id: conversationRecord.id,
            title: conversationRecord.title,
            createdAt: conversationRecord.createdAt,
            updatedAt: conversationRecord.updatedAt,
            messages: conversationRecord.rounds
              .getItems()
              .filter(round => round.role !== 'system')
              .map(serializeRound),
            activeAgents: getActiveAgentsForSession(conversationRecord.id),
          },
        });
        void broadcastSessionsList();
      });

      app.patch('/api/chat/:id', async (req, res) => {
        // This should send the message to the assistant as part of the chat session with the given
        // id, and return the assistant's reply. The message should be added to the conversation
        // history for that chat session in the database, and the assistant's reply should also be
        // added to the conversation history in the database.

        const { id } = req.params;
        const { message } = req.body;

        const em = orm.em.fork();
        const session = await em.findOne(
          ChatSession,
          { id: parseInt(id) },
          { populate: ['rounds'] }
        );
        if (!session) {
          res.status(404).json({ error: 'Chat session not found' });
          return;
        }

        const updatedSession = await runSessionOperation(
          session.id,
          async () => {
            const em = orm.em.fork();
            const queuedSession = await em.findOne(
              ChatSession,
              { id: session.id },
              { populate: ['rounds'] }
            );
            if (!queuedSession) {
              throw new Error(
                `Chat session ${session.id} not found while processing message.`
              );
            }

            const activeInstance = TaskAssistants.getActiveInstance(session.id);
            if (activeInstance) {
              await activeInstance.conversation.appendExternalMessage({
                role: 'user',
                content: message,
              });
              await persistUnsynchronizedMessages(
                em,
                queuedSession,
                activeInstance.conversation,
                'chat',
                activeInstance.definition.name
              );
              await activeInstance.conversation.sendUserMessage();
              await persistUnsynchronizedMessages(
                em,
                queuedSession,
                activeInstance.conversation,
                'chat',
                activeInstance.definition.name
              );

              // If sendUserMessage() triggered task assistant completion, inject the
              // handback into the parent conversation and let the main assistant wrap up.
              const completedResult = TaskAssistants.getAndClearCompletedResult(
                session.id
              );
              if (completedResult) {
                const llmTransaction =
                  getOrCreateCachedConversation(queuedSession);
                await llmTransaction.appendExternalMessage({
                  role: 'system',
                  content:
                    `Task assistant "${completedResult.taskAssistantName}" has completed.\n\n` +
                    completedResult.handbackMessage,
                });
                await llmTransaction.sendUserMessage();
                await persistUnsynchronizedMessages(
                  em,
                  queuedSession,
                  llmTransaction,
                  'chat'
                );

                const titleSummary = await llmTransaction.requestTitle();
                queuedSession.title =
                  titleSummary.length > 0 ? titleSummary : 'New Conversation';
              }

              queuedSession.updatedAt = new Date();
              await em.flush();
              return queuedSession;
            }

            const llmTransaction = getOrCreateCachedConversation(queuedSession);

            await llmTransaction.appendExternalMessage({
              role: 'user',
              content: message,
            });
            await persistUnsynchronizedMessages(
              em,
              queuedSession,
              llmTransaction,
              'chat'
            );

            // Drain any pending agent messages into the LLM context before processing
            const pendingAgentMessages = AgentSystem.getAndClearPendingMessages(
              session.id
            );
            for (const agentMsg of pendingAgentMessages) {
              await llmTransaction.appendExternalMessage({
                role: 'system',
                content: `## ${agentMsg.heading}\n\n${agentMsg.content}`,
              });
            }

            await llmTransaction.sendUserMessage();

            await persistUnsynchronizedMessages(
              em,
              queuedSession,
              llmTransaction,
              'chat'
            );

            // If the parent LLM called a task assistant start tool during this turn,
            // also persist the task assistant's seed messages (kickoff greeting etc.)
            // so they appear immediately in the response.
            const newTaskAssistant = TaskAssistants.getActiveInstance(
              session.id
            );
            if (newTaskAssistant) {
              await persistUnsynchronizedMessages(
                em,
                queuedSession,
                newTaskAssistant.conversation,
                'chat',
                newTaskAssistant.definition.name
              );
            }

            const titleSummary = await llmTransaction.requestTitle();
            queuedSession.title =
              titleSummary.length > 0 ? titleSummary : 'New Conversation';

            await em.flush();

            return queuedSession;
          }
        );

        res.json({
          session: {
            id,
            title: updatedSession.title,
            createdAt: updatedSession.createdAt,
            updatedAt: updatedSession.updatedAt,
            messages: updatedSession.rounds
              .getItems()
              .filter(round => round.role !== 'system')
              .map(serializeRound),
            activeAgents: getActiveAgentsForSession(updatedSession.id),
          },
        });
        broadcastWs({
          type: 'session_updated',
          sessionId: updatedSession.id,
          session: buildWsSession(updatedSession, updatedSession.id),
        });
        void broadcastSessionsList();
      });

      app.get('/api/chat', async (req, res) => {
        // This should return a list of open chat sessions. Each session should include
        // the id, the creation timestamp, the last message timestamp, an LLM-provided
        // title for the conversation, and the last message from the user and the assistant.

        const em = orm.em.fork();

        const sessions = await em.find(
          ChatSession,
          {},
          { populate: ['rounds'] }
        );

        res.json({
          sessions: sessions.map(session => ({
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            lastMessageAt:
              session.rounds.getItems().length > 0
                ? session.rounds.getItems()[
                    session.rounds.getItems().length - 1
                  ].timestamp
                : session.createdAt,
            lastUserMessage:
              session.rounds.getItems().length > 0
                ? session.rounds.getItems()[
                    session.rounds.getItems().length - 1
                  ].content
                : '',
            lastAssistantMessage:
              session.rounds.getItems().length > 1
                ? session.rounds.getItems()[
                    session.rounds.getItems().length - 2
                  ].content
                : '',
          })),
        });
      });

      app.get('/api/chat/:id', async (req, res) => {
        const { id } = req.params;
        // This should return the full message history for the chat session with the given id,
        // including both user and assistant messages, in chronological order, as well as the
        // conversation title, and creation timestamp.

        const em = orm.em.fork();
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
            assistantMood: 'happy', // This will pull from the global "mood" state the assistant can set through tools. It's common across all assistant conversations.
            messages: session.rounds
              .getItems()
              .filter(round => round.role !== 'system')
              .map(serializeRound),
            activeAgents: getActiveAgentsForSession(session.id),
          },
        });
      });

      app.delete('/api/chat/:id', async (req, res) => {
        const { id } = req.params;
        // TODO: wire up to Alice assistant logic.

        // This should tell the LLM to summarize the chat, so we can save it to memory, and remove the
        // session from the database.

        // Step 1. Check if there are any user messages in the chat. If not, we''' just delete it.
        const parsedId = parseInt(id);
        const em = orm.em.fork();
        const session = await em.findOne(
          ChatSession,
          { id: parsedId },
          { populate: ['rounds'] }
        );
        if (!session) {
          res.status(404).json({ error: 'Chat session not found' });
          return;
        }

        await runSessionOperation(parsedId, async () => {
          const em = orm.em.fork();
          const queuedSession = await em.findOne(
            ChatSession,
            { id: parsedId },
            { populate: ['rounds'] }
          );
          if (!queuedSession) {
            throw new Error(
              `Chat session ${parsedId} not found while deleting session.`
            );
          }

          const userMessages = queuedSession.rounds
            .getItems()
            .filter(round => round.role === 'user');
          if (userMessages.length > 0) {
            plugin.logger.log(
              `Requesting conversation summary for chat session ${id} before deletion...`
            );
            getOrCreateCachedConversation(queuedSession);
            await closeAndEvictCachedConversation(parsedId);
          } else {
            evictCachedConversation(parsedId);
          }

          queuedSession.rounds.removeAll();
          em.remove(queuedSession);
          await em.flush();
        });

        res.json({ reply: `Chat session with id ${id} deleted successfully` });
        plugin.logger.log(`Chat session ${id} deleted successfully.`);
        void broadcastSessionsList();
        return;
      });

      app.post('/api/chat/:id/compact', async (req, res) => {
        // Compacts the conversation context for the given session. The LLM
        // summarizes older messages so the context window stays manageable.
        // Supports ?mode=full (summarize everything) and ?mode=clear
        // (summarize + evict summaries to memory). Default is "normal"
        // (auto-threshold compaction).

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

        const em = orm.em.fork();
        const session = await em.findOne(
          ChatSession,
          { id: parsedId },
          { populate: ['rounds'] }
        );
        if (!session) {
          res.status(404).json({ error: 'Chat session not found' });
          return;
        }

        const result = await runSessionOperation(parsedId, async () => {
          const em = orm.em.fork();
          const queuedSession = await em.findOne(
            ChatSession,
            { id: parsedId },
            { populate: ['rounds'] }
          );
          if (!queuedSession) {
            throw new Error(
              `Chat session ${parsedId} not found while compacting.`
            );
          }

          const conversation = getOrCreateCachedConversation(queuedSession);
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
            await em.flush();
          }

          return { didCompact, mode };
        });

        res.json({
          sessionId: parsedId,
          compacted: result.didCompact,
          mode: result.mode,
        });

        if (result.didCompact) {
          broadcastWs({
            type: 'session_updated',
            sessionId: parsedId,
            session: buildWsSession(session, parsedId),
          });
        }
      });

      app.get('/api/extensions', async (_req, res) => {
        const groupsWithScripts = new Set(
          registeredScripts.map(registration => registration.groupKey)
        );
        const styleOnlyExtensions: AliceUiScriptRegistration[] = [];

        stylesheetUrlsByGroup.forEach((styleUrls, groupKey) => {
          if (styleUrls.length === 0 || groupsWithScripts.has(groupKey)) {
            return;
          }

          const styleOnlyId = createHash('sha1')
            .update(`style-only:${groupKey}`)
            .digest('hex')
            .slice(0, 12);

          styleOnlyExtensions.push({
            id: styleOnlyId,
            styleUrls: [...styleUrls],
          });
        });

        res.setHeader('Cache-Control', 'no-store');
        res.json({
          extensions: [
            ...registeredScripts.map(
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              ({ groupKey: _groupKey, ...registration }) => registration
            ),
            ...styleOnlyExtensions,
          ],
        });
      });

      app.get(
        /^\/(?!api(?:\/|$)|plugin-scripts(?:\/|$)|plugin-styles(?:\/|$)).*/,
        (_req, res) => {
          res.sendFile(path.join(currentDir, 'client', 'index.html'));
        }
      );

      plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
        plugin.logger.log(
          'onAssistantWillStopAcceptingRequests: Starting web UI WS + chat session shutdown.'
        );

        // Stop heartbeat and close all WS connections cleanly.
        clearInterval(heartbeatInterval);
        for (const ws of wsConnections) {
          ws.close();
        }
        wsConnections.clear();
        await new Promise<void>(resolve => wss.close(() => resolve()));

        await flushAndEvictAllCachedConversations();
        plugin.logger.log(
          'onAssistantWillStopAcceptingRequests: Completed web UI WS + chat session shutdown.'
        );
      });

      plugin.logger.log(
        'onAssistantAcceptsRequests: Completed web UI route and handler registration.'
      );
    });
  },
};

export default webUiPlugin;
