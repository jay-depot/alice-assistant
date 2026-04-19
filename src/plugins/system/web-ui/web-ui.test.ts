/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../lib/plugin-hooks.js', () => ({
  PluginHooks: vi.fn(() => ({})),
  PluginHookInvocations: {
    invokeOnContextCompactionSummariesWillBeDeleted: vi
      .fn()
      .mockResolvedValue(undefined),
    invokeOnUserConversationWillBegin: vi.fn().mockResolvedValue(undefined),
    invokeOnUserConversationWillEnd: vi.fn().mockResolvedValue(undefined),
  },
}));

const {
  mockExistsSync,
  mockStatSync,
  mockMkdirSync,
  mockReadFileSync,
  mockStartConversation,
  mockTaskAssistants,
  mockAgentSystem,
  mockRegisterDatabaseModels,
  mockOnDatabaseReady,
  mockApp,
  mockExpress,
  mockExpressJson,
  mockExpressStatic,
  mockWss,
  mockWebSocketServer,
} = vi.hoisted(() => {
  const app = {
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    listen: vi.fn(),
  };

  const expressFn = vi.fn(() => app);
  const expressJson = vi.fn(() => 'json-middleware');
  const expressStatic = vi.fn(() => 'static-middleware');

  const taskAssistants = {
    getActiveInstance: vi.fn(() => null),
    getAndClearCompletedResult: vi.fn(() => undefined),
  };

  const agentSystem = {
    onUpdate: vi.fn(),
    getInstancesBySession: vi.fn(() => []),
    getAndClearPendingMessages: vi.fn(() => []),
  };

  const wss = {
    on: vi.fn(),
    close: vi.fn(function (cb?: () => void) {
      cb?.();
    }),
  };
  // Must be a regular function (not arrow) so `new WebSocketServer(...)` works.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const webSocketServer = vi.fn(function (_opts: unknown) {
    return wss;
  });

  return {
    mockExistsSync: vi.fn(),
    mockStatSync: vi.fn(),
    mockMkdirSync: vi.fn(),
    mockReadFileSync: vi.fn(),
    mockStartConversation: vi.fn(),
    mockTaskAssistants: taskAssistants,
    mockAgentSystem: agentSystem,
    mockRegisterDatabaseModels: vi.fn(),
    mockOnDatabaseReady: vi.fn(),
    mockApp: app,
    mockExpress: expressFn,
    mockExpressJson: expressJson,
    mockExpressStatic: expressStatic,
    mockWss: wss,
    mockWebSocketServer: webSocketServer,
  };
});

vi.mock('ws', () => ({
  WebSocketServer: mockWebSocketServer,
  WebSocket: { OPEN: 1 },
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  statSync: mockStatSync,
  mkdirSync: mockMkdirSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('express', () => {
  const expressExport = Object.assign(mockExpress, {
    json: mockExpressJson,
    static: mockExpressStatic,
  });
  return {
    default: expressExport,
    static: mockExpressStatic,
  };
});

vi.mock('../../../lib/user-config.js', () => ({
  UserConfig: {
    getConfig: () => ({
      webInterface: {
        port: 47153,
        bindToAddress: '127.0.0.1',
      },
    }),
    getConfigPath: () => '/mock/config',
  },
}));

vi.mock('../../../lib.js', () => ({
  startConversation: mockStartConversation,
  TaskAssistants: mockTaskAssistants,
  AgentSystem: mockAgentSystem,
  ToolCallEvents: {
    onToolCallEvent: vi.fn(),
    dispatchToolCallEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

import type { AlicePluginInterface } from '../../../lib.js';
import webUiPlugin from './web-ui.js';

type ChatSessionRecord = {
  id: number;
  title: string;
  rounds: {
    items: any[];
    getItems: () => any[];
    add: (item: any) => void;
    removeAll: () => void;
  };
  createdAt: Date;
  updatedAt: Date;
};

const makeRounds = (items: any[] = []) => ({
  items,
  getItems() {
    return this.items;
  },
  add(item: any) {
    this.items.push(item);
  },
  removeAll() {
    this.items = [];
  },
});

function createMockOrm(initialSessions: ChatSessionRecord[] = []) {
  let nextId = initialSessions.length + 1;
  const sessions = [...initialSessions];

  const em = {
    fork: () => em,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    find: vi.fn(async (_entity: any) => sessions),
    findOne: vi.fn(async (_entity: any, where: any) => {
      if (where.id !== undefined) {
        return sessions.find(s => s.id === where.id) ?? null;
      }

      if (Object.keys(where).length === 0) {
        if (sessions.length === 0) return null;
        const sorted = [...sessions].sort((a, b) => {
          const byUpdated = b.updatedAt.getTime() - a.updatedAt.getTime();
          if (byUpdated !== 0) return byUpdated;
          return b.id - a.id;
        });
        return sorted[0] ?? null;
      }

      return null;
    }),
    create: vi.fn((_entity: any, data: any) => {
      const record: any = {
        id: nextId++,
        ...data,
      };
      if (data.title !== undefined) {
        // It's a ChatSession — give it a rounds collection and track it.
        record.rounds = makeRounds([]);
        sessions.push(record as ChatSessionRecord);
      }
      return record;
    }),
    remove: vi.fn((record: ChatSessionRecord) => {
      const idx = sessions.findIndex(s => s.id === record.id);
      if (idx >= 0) {
        sessions.splice(idx, 1);
      }
      return em;
    }),
    flush: vi.fn().mockResolvedValue(undefined),
  };

  return {
    em,
    sessions,
  };
}

function createMockPluginInterface(initialSessions: ChatSessionRecord[] = []) {
  const offeredCapabilities: Record<string, any> = {};
  const orm = createMockOrm(initialSessions);
  const hookCallbacks: Record<string, Array<() => Promise<void>>> = {
    onAssistantAcceptsRequests: [],
    onAssistantWillStopAcceptingRequests: [],
  };

  mockOnDatabaseReady.mockImplementation(
    async (cb: (databaseOrm: any) => Promise<any>) => cb(orm)
  );

  return {
    offeredCapabilities,
    orm,
    runHook: async (hookName: string) => {
      for (const callback of hookCallbacks[hookName] ?? []) {
        await callback();
      }
    },
    registerPlugin: async () => ({
      logger: {
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      registerTool: vi.fn(),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      config: vi.fn(),
      hooks: {
        onAllPluginsLoaded: vi.fn(),
        onAssistantWillAcceptRequests: vi.fn(),
        onAssistantAcceptsRequests: (cb: () => Promise<void>) => {
          hookCallbacks.onAssistantAcceptsRequests.push(cb);
        },
        onAssistantWillStopAcceptingRequests: (cb: () => Promise<void>) => {
          hookCallbacks.onAssistantWillStopAcceptingRequests.push(cb);
        },
        onAssistantStoppedAcceptingRequests: vi.fn(),
        onPluginsWillUnload: vi.fn(),
        onTaskAssistantWillBegin: vi.fn(),
        onTaskAssistantWillEnd: vi.fn(),
        onUserConversationWillBegin: vi.fn(),
        onUserConversationWillEnd: vi.fn(),
        onContextCompactionSummariesWillBeDeleted: vi.fn(),
      },
      offer: (caps: any) => {
        offeredCapabilities['web-ui'] = caps;
      },
      request: (pluginId: string) => {
        if (pluginId === 'memory') {
          return {
            onDatabaseReady: mockOnDatabaseReady,
            registerDatabaseModels: mockRegisterDatabaseModels,
          };
        }
        if (pluginId === 'rest-serve') {
          return {
            express: mockApp,
            server: {
              on: vi.fn(),
              off: vi.fn(),
            },
          };
        }
        return undefined;
      },
      registerWebSocket: vi.fn(() => mockWss),
    }),
  };
}

describe('webUiPlugin', () => {
  beforeEach(() => {
    mockExistsSync.mockReset().mockReturnValue(false);
    mockStatSync.mockReset().mockReturnValue({ isFile: () => true });
    mockMkdirSync.mockReset();
    mockReadFileSync.mockReset().mockReturnValue('');
    mockStartConversation.mockReset().mockReturnValue({
      restoreContext: vi.fn(),
      getUnsynchronizedMessages: vi.fn(() => []),
      markUnsynchronizedMessagesSynchronized: vi.fn(),
      appendExternalMessage: vi.fn(),
      closeConversation: vi.fn(),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
      requestTitle: vi.fn(async () => 'New Conversation'),
    });
    mockTaskAssistants.getActiveInstance.mockReset().mockReturnValue(null);
    mockTaskAssistants.getAndClearCompletedResult
      .mockReset()
      .mockReturnValue(undefined);
    mockAgentSystem.onUpdate.mockReset();
    mockAgentSystem.getInstancesBySession.mockReset().mockReturnValue([]);
    mockAgentSystem.getAndClearPendingMessages.mockReset().mockReturnValue([]);
    mockRegisterDatabaseModels.mockReset();
    mockOnDatabaseReady.mockReset();
    mockApp.get.mockReset();
    mockApp.use.mockReset();
    mockApp.post.mockReset();
    mockApp.patch.mockReset();
    mockApp.delete.mockReset();
    mockApp.listen.mockReset().mockReturnValue({ close: vi.fn() });
    mockExpress.mockClear();
    mockExpressJson.mockClear();
    mockExpressStatic.mockClear();
    mockWebSocketServer.mockClear();
    mockWss.on.mockClear();
    mockWss.close.mockClear();
  });

  const getRegisteredRouteHandler = (
    method: 'get' | 'post' | 'patch' | 'delete',
    route: string
  ) => {
    const call = (mockApp[method] as any).mock.calls.find(
      (entry: any[]) => entry[0] === route
    );
    return call?.[1] as
      | ((req: any, res: any) => Promise<void> | void)
      | undefined;
  };

  const createMockResponse = () => {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      sendFile: vi.fn().mockReturnThis(),
    };
    return response;
  };

  it('has correct plugin metadata', () => {
    expect(webUiPlugin.pluginMetadata).toMatchObject({
      id: 'web-ui',
      name: 'Web UI Plugin',
      version: 'LATEST',
      required: true,
    });
  });

  it('declares dependency on memory', () => {
    const depIds = webUiPlugin.pluginMetadata.dependencies!.map(d => d.id);
    expect(depIds).toContain('memory');
    expect(depIds).toContain('rest-serve');
  });

  it('offers expected web-ui capabilities', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const api = mockInterface.offeredCapabilities['web-ui'];
    expect(typeof api.registerScript).toBe('function');
    expect(typeof api.registerStylesheet).toBe('function');
    expect(typeof api.resolveTargetChatSession).toBe('function');
    expect(typeof api.queueAssistantMessageToSession).toBe('function');
    expect(typeof api.queueAssistantMessage).toBe('function');
    expect(typeof api.queueAssistantInterruption).toBe('function');
    expect(api.express).toBeDefined();
  });

  it('registers ChatSession and ChatSessionRound models with memory plugin', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    expect(mockRegisterDatabaseModels).toHaveBeenCalledTimes(1);
    expect(mockRegisterDatabaseModels).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Function), expect.any(Function)])
    );
  });

  it('registerScript throws when the file does not exist', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['web-ui'];

    mockExistsSync.mockReturnValue(false);

    expect(() => api.registerScript('/tmp/nope.js')).toThrow(
      /could not find file/i
    );
  });

  it('registerScript throws when path exists but is not a file', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['web-ui'];

    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isFile: () => false });

    expect(() => api.registerScript('/tmp/not-a-file')).toThrow(
      /expected a file path/i
    );
  });

  it('registerStylesheet throws when the file does not exist', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['web-ui'];

    mockExistsSync.mockReturnValue(false);

    expect(() => api.registerStylesheet('/tmp/nope.css')).toThrow(
      /could not find file/i
    );
  });

  it('registerStylesheet throws when path exists but is not a file', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['web-ui'];

    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isFile: () => false });

    expect(() => api.registerStylesheet('/tmp/not-a-file')).toThrow(
      /expected a file path/i
    );
  });

  it('duplicate registerScript call is ignored after first registration', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['web-ui'];

    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isFile: () => true });

    api.registerScript('/tmp/plugin-client.js');
    const getCallsAfterFirst = mockApp.get.mock.calls.length;

    api.registerScript('/tmp/plugin-client.js');
    const getCallsAfterSecond = mockApp.get.mock.calls.length;

    expect(getCallsAfterSecond).toBe(getCallsAfterFirst);
  });

  it('resolveTargetChatSession returns null when no session exists and openNewChatIfNone is false', async () => {
    const mockInterface = createMockPluginInterface([]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['web-ui'];

    const result = await api.resolveTargetChatSession({
      openNewChatIfNone: false,
    });
    expect(result).toBeNull();
  });

  it('resolveTargetChatSession creates and returns a session id when openNewChatIfNone is true', async () => {
    const mockInterface = createMockPluginInterface([]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['web-ui'];

    const result = await api.resolveTargetChatSession({
      title: 'From test',
      openNewChatIfNone: true,
    });

    expect(typeof result).toBe('number');
    expect(result).toBe(1);
    expect(mockStartConversation).toHaveBeenCalledWith('chat', {
      sessionId: 1,
    });
  });

  it('resolveTargetChatSession always creates a session when alwaysOpenNewChat is true', async () => {
    const existingSession: ChatSessionRecord = {
      id: 9,
      title: 'Existing',
      rounds: {
        items: [],
        getItems() {
          return this.items;
        },
        add(item: any) {
          this.items.push(item);
        },
        removeAll: function (): void {
          throw new Error('Function not implemented.');
        },
      },
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const mockInterface = createMockPluginInterface([existingSession]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['web-ui'];

    const result = await api.resolveTargetChatSession({
      alwaysOpenNewChat: true,
    });

    expect(result).toBe(2);
    expect(mockStartConversation).toHaveBeenCalledWith('chat', {
      sessionId: 2,
    });
  });

  it('queueAssistantInterruption returns null when no target session is available', async () => {
    const mockInterface = createMockPluginInterface([]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['web-ui'];

    const result = await api.queueAssistantInterruption({
      content: 'Heads up',
    });

    expect(result).toBeNull();
  });

  it('user-style route returns 204 when user-style.css is missing', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    mockExistsSync.mockReturnValue(false);
    const handler = getRegisteredRouteHandler('get', '/user-style.css');
    const res = createMockResponse();

    await handler?.({}, res);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('user-style route serves CSS when user-style.css exists', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('body { color: red; }');

    const handler = getRegisteredRouteHandler('get', '/user-style.css');
    const res = createMockResponse();
    await handler?.({}, res);

    expect(res.type).toHaveBeenCalledWith('text/css');
    expect(res.send).toHaveBeenCalledWith('body { color: red; }');
  });

  it('registers /api/chat routes when assistant accepts requests', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    await mockInterface.runHook('onAssistantAcceptsRequests');

    expect(getRegisteredRouteHandler('post', '/api/chat')).toBeDefined();
    expect(getRegisteredRouteHandler('patch', '/api/chat/:id')).toBeDefined();
    expect(getRegisteredRouteHandler('get', '/api/chat')).toBeDefined();
    expect(getRegisteredRouteHandler('get', '/api/chat/:id')).toBeDefined();
    expect(getRegisteredRouteHandler('delete', '/api/chat/:id')).toBeDefined();
    expect(getRegisteredRouteHandler('get', '/api/extensions')).toBeDefined();
  });

  it('POST /api/chat/:id/compact broadcasts session_updated with post-compaction session state', async () => {
    const existingSession: ChatSessionRecord = {
      id: 1,
      title: 'Existing',
      rounds: makeRounds([]),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const mockInterface = createMockPluginInterface([existingSession]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    await mockInterface.runHook('onAssistantAcceptsRequests');

    const compactHandler = getRegisteredRouteHandler('post', '/api/chat/:id/compact');
    const connectionHandler = mockWss.on.mock.calls.find(
      (entry: any[]) => entry[0] === 'connection'
    )?.[1] as ((ws: any) => void) | undefined;

    const wsClient = {
      readyState: 1,
      send: vi.fn(),
      on: vi.fn(),
    };
    connectionHandler?.(wsClient);

    mockStartConversation.mockReturnValueOnce({
      restoreContext: vi.fn(),
      compactContext: vi.fn().mockResolvedValue(true),
      compactedContext: [{ role: 'assistant', content: 'summary' }],
      getUnsynchronizedMessages: vi.fn(() => []),
      markUnsynchronizedMessagesSynchronized: vi.fn(),
      appendExternalMessage: vi.fn(),
      closeConversation: vi.fn(),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
      requestTitle: vi.fn(async () => 'New Conversation'),
    });

    const res = createMockResponse();
    await compactHandler?.(
      { params: { id: '1' }, query: { mode: 'full' } },
      res
    );

    const sentMessages = wsClient.send.mock.calls.map((call: [string]) =>
      JSON.parse(call[0])
    );
    const updatedMessage = sentMessages.find(
      (msg: any) => msg.type === 'session_updated'
    );

    expect(res.json).toHaveBeenCalledWith({
      sessionId: 1,
      compacted: true,
      mode: 'full',
    });
    expect(updatedMessage).toBeDefined();
    expect(updatedMessage.session.hasCompactedContext).toBe(true);
  });

  it('POST /api/chat creates a chat session and returns session payload', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    await mockInterface.runHook('onAssistantAcceptsRequests');

    const handler = getRegisteredRouteHandler('post', '/api/chat');
    const res = createMockResponse();

    await handler?.({}, res);

    expect(mockStartConversation).toHaveBeenCalledWith('chat', {
      sessionId: 1,
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ id: 1, title: 'New Conversation' }),
      })
    );
  });

  it('PATCH /api/chat/:id returns 404 when session is missing', async () => {
    const mockInterface = createMockPluginInterface();
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    await mockInterface.runHook('onAssistantAcceptsRequests');

    const handler = getRegisteredRouteHandler('patch', '/api/chat/:id');
    const res = createMockResponse();

    await handler?.({ params: { id: '999' }, body: { message: 'hello' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Chat session not found' })
    );
  });

  it('PATCH /api/chat/:id routes to parent LLM with handback when task assistant completes', async () => {
    const now = new Date('2026-04-12T00:00:00Z');
    const mockInterface = createMockPluginInterface([
      {
        id: 11,
        title: 'Task Session',
        rounds: makeRounds([]),
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const taMessages: Array<{ role: string; content: string }> = [];
    const parentMessages: Array<{ role: string; content: string }> = [];

    const taSendUserMessage = vi.fn().mockResolvedValue(undefined);
    const parentSendUserMessage = vi.fn().mockResolvedValue(undefined);

    const taConversation = {
      restoreContext: vi.fn().mockReturnThis(),
      getUnsynchronizedMessages: vi.fn(() => [...taMessages]),
      markUnsynchronizedMessagesSynchronized: vi.fn(() => taMessages.splice(0)),
      appendExternalMessage: vi.fn(
        async (m: { role: string; content: string }) => taMessages.push(m)
      ),
      closeConversation: vi.fn(),
      sendUserMessage: taSendUserMessage,
      requestTitle: vi.fn(async () => 'Task Session'),
    };

    const parentConversation = {
      restoreContext: vi.fn().mockReturnThis(),
      getUnsynchronizedMessages: vi.fn(() => [...parentMessages]),
      markUnsynchronizedMessagesSynchronized: vi.fn(() =>
        parentMessages.splice(0)
      ),
      appendExternalMessage: vi.fn(
        async (m: { role: string; content: string }) => parentMessages.push(m)
      ),
      closeConversation: vi.fn(),
      sendUserMessage: parentSendUserMessage,
      requestTitle: vi.fn(async () => 'Task Session Updated'),
    };

    // startConversation is only called for the parent conversation in this PATCH path;
    // the task assistant conversation is accessed via taInstance.conversation directly.
    mockStartConversation.mockReset().mockReturnValue(parentConversation);

    const taInstance = {
      definition: { name: 'Test Task Assistant', id: 'test-task-assistant' },
      conversation: taConversation,
    };

    const completedResult = {
      taskAssistantId: 'test-task-assistant',
      taskAssistantName: 'Test Task Assistant',
      conversationType: 'test-task-assistant',
      status: 'completed',
      summary: 'Test done',
      handbackMessage: 'The test is complete!',
    };

    // getActiveInstance returns the TA instance
    //@ts-expect-error -- testing affordance
    mockTaskAssistants.getActiveInstance.mockReturnValue(taInstance);
    // getAndClearCompletedResult returns the result after TA finishes
    mockTaskAssistants.getAndClearCompletedResult.mockReturnValue(
      //@ts-expect-error -- testing affordance
      completedResult
    );

    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    await mockInterface.runHook('onAssistantAcceptsRequests');

    const handler = getRegisteredRouteHandler('patch', '/api/chat/:id');
    expect(handler).toBeDefined();
    const res = createMockResponse();

    taMessages.push({
      role: 'assistant',
      content: 'Wrap-up from task assistant',
    });
    parentMessages.push({ role: 'assistant', content: 'Parent wrap-up' });

    await handler!({ params: { id: '11' }, body: { message: 'done' } }, res);

    expect(taSendUserMessage).toHaveBeenCalled();
    expect(mockTaskAssistants.getAndClearCompletedResult).toHaveBeenCalled();
    expect(parentConversation.appendExternalMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('The test is complete!'),
      })
    );
    expect(parentSendUserMessage).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          id: '11',
          title: 'Task Session Updated',
        }),
      })
    );
  });

  it('GET /api/chat returns session summaries', async () => {
    const now = new Date('2026-04-12T00:00:00Z');
    const mockInterface = createMockPluginInterface([
      {
        id: 1,
        title: 'Session One',
        rounds: makeRounds([
          {
            role: 'assistant',
            content: 'assistant reply',
            messageKind: 'chat',
            timestamp: now,
          },
          {
            role: 'user',
            content: 'user message',
            messageKind: 'chat',
            timestamp: now,
          },
        ]),
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    await mockInterface.runHook('onAssistantAcceptsRequests');

    const handler = getRegisteredRouteHandler('get', '/api/chat');
    const res = createMockResponse();
    await handler?.({}, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            title: 'Session One',
            lastUserMessage: 'user message',
            lastAssistantMessage: 'assistant reply',
          }),
        ]),
      })
    );
  });

  it('GET /api/chat/:id returns 404 when the session does not exist', async () => {
    const mockInterface = createMockPluginInterface([]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    await mockInterface.runHook('onAssistantAcceptsRequests');

    const handler = getRegisteredRouteHandler('get', '/api/chat/:id');
    const res = createMockResponse();
    await handler?.({ params: { id: '55' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Chat session not found' })
    );
  });

  it('GET /api/chat/:id returns full session details when found', async () => {
    const now = new Date('2026-04-12T00:00:00Z');
    const mockInterface = createMockPluginInterface([
      {
        id: 2,
        title: 'Detailed Session',
        rounds: makeRounds([
          {
            role: 'user',
            content: 'hello',
            messageKind: 'chat',
            timestamp: now,
            senderName: null,
          },
          {
            role: 'assistant',
            content: 'hi there',
            messageKind: 'chat',
            timestamp: now,
            senderName: null,
          },
        ]),
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    await mockInterface.runHook('onAssistantAcceptsRequests');

    const handler = getRegisteredRouteHandler('get', '/api/chat/:id');
    const res = createMockResponse();
    await handler?.({ params: { id: '2' } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          id: '2',
          title: 'Detailed Session',
          assistantMood: 'happy',
        }),
      })
    );
  });

  it('DELETE /api/chat/:id returns 404 when the session does not exist', async () => {
    const mockInterface = createMockPluginInterface([]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    await mockInterface.runHook('onAssistantAcceptsRequests');

    const handler = getRegisteredRouteHandler('delete', '/api/chat/:id');
    const res = createMockResponse();
    await handler?.({ params: { id: '404' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Chat session not found' })
    );
  });

  it('DELETE /api/chat/:id deletes empty chat sessions successfully', async () => {
    const now = new Date('2026-04-12T00:00:00Z');
    const mockInterface = createMockPluginInterface([
      {
        id: 3,
        title: 'Delete Me',
        rounds: makeRounds([]),
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    await mockInterface.runHook('onAssistantAcceptsRequests');

    const handler = getRegisteredRouteHandler('delete', '/api/chat/:id');
    const res = createMockResponse();
    await handler?.({ params: { id: '3' } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        reply: 'Chat session with id 3 deleted successfully',
      })
    );
    expect(mockInterface.orm.sessions.find(s => s.id === 3)).toBeUndefined();
  });

  it('GET /api/extensions returns the registered extension manifest list', async () => {
    const mockInterface = createMockPluginInterface([]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    await mockInterface.runHook('onAssistantAcceptsRequests');

    const handler = getRegisteredRouteHandler('get', '/api/extensions');
    const res = createMockResponse();
    await handler?.({}, res);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: expect.any(Array),
      })
    );
  });

  it('GET /api/extensions includes stylesheet-only registrations', async () => {
    const mockInterface = createMockPluginInterface([]);
    await webUiPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const api = mockInterface.offeredCapabilities['web-ui'];
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isFile: () => true });
    api.registerStylesheet('/tmp/deep-dive.css');

    await mockInterface.runHook('onAssistantAcceptsRequests');

    const handler = getRegisteredRouteHandler('get', '/api/extensions');
    const res = createMockResponse();
    await handler?.({}, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        extensions: expect.arrayContaining([
          expect.objectContaining({
            styleUrls: expect.arrayContaining([
              expect.stringMatching(/^\/plugin-styles\//),
            ]),
          }),
        ]),
      })
    );
  });
});
