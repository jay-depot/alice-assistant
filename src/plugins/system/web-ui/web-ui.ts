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
import { Express, static as serveStatic, Response } from 'express';
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

    // SSE connection management: Map<sessionId, Set<Response>>
    const sseConnections = new Map<number, Set<Response>>();

    // Buffer for tool call rounds collected during sendUserMessage() so they can be flushed
    // into the DB *before* the final assistant response — ensuring correct display order.
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

    const addSseConnection = (sessionId: number, res: Response): void => {
      if (!sseConnections.has(sessionId)) {
        sseConnections.set(sessionId, new Set());
      }
      sseConnections.get(sessionId)!.add(res);
    };

    const removeSseConnection = (sessionId: number, res: Response): void => {
      sseConnections.get(sessionId)?.delete(res);
      if (sseConnections.get(sessionId)?.size === 0) {
        sseConnections.delete(sessionId);
      }
    };

    const closeSseConnectionsForSession = (sessionId: number): void => {
      const connections = sseConnections.get(sessionId);
      if (connections) {
        for (const res of connections) {
          res.end();
        }
        sseConnections.delete(sessionId);
      }
    };

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

    const serializeRound = (round: ChatSessionRound) => ({
      role: round.role,
      messageKind: round.messageKind,
      content: round.content,
      timestamp: round.timestamp,
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
        restoreConversationMessages(session.rounds.getItems())
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

    // Subscribe to tool call events and broadcast to SSE connections
    ToolCallEvents.onToolCallEvent(async event => {
      const sessionId = event.sessionId;
      if (sessionId === undefined) {
        return;
      }

      const connections = sseConnections.get(sessionId);
      if (!connections || connections.size === 0) {
        return;
      }

      // Enrich the event with agentName so the client can apply agent-specific
      // CSS classes to in-flight tool call batches without a separate lookup.
      const agentName = event.agentInstanceId
        ? AgentSystem.getInstancesBySession(sessionId).find(
            i => i.instanceId === event.agentInstanceId
          )?.agentName
        : undefined;
      const sseData = JSON.stringify(
        agentName ? { ...event, agentName } : event
      );
      for (const res of connections) {
        res.write(`event: ${event.type}\ndata: ${sseData}\n\n`);
      }
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

      // SSE endpoint for real-time tool call events
      app.get('/api/chat/:id/events', (req, res) => {
        const sessionId = parseInt(req.params.id);

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
        res.flushHeaders();

        // Track this connection
        addSseConnection(sessionId, res);

        // Send a comment to keep the connection alive immediately
        res.write(': connected\n\n');

        // Clean up on client disconnect
        req.on('close', () => {
          removeSseConnection(sessionId, res);
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

          // Close any SSE connections for this session
          closeSseConnectionsForSession(parsedId);

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
        return;
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
          'onAssistantWillStopAcceptingRequests: Starting web UI chat session cache flush.'
        );
        await flushAndEvictAllCachedConversations();
        plugin.logger.log(
          'onAssistantWillStopAcceptingRequests: Completed web UI chat session cache flush.'
        );
      });

      plugin.logger.log(
        'onAssistantAcceptsRequests: Completed web UI route and handler registration.'
      );
    });
  },
};

export default webUiPlugin;
