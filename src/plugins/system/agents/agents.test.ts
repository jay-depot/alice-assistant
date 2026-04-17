import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetIndependentInstances,
  mockGetIndependentInstance,
  mockCancelBySession,
  mockPauseIndependentAgent,
  mockResumeIndependentAgent,
  mockSuspendIndependentAgent,
  mockFreezeAllIndependentAgents,
  mockThawIndependentAgent,
  mockStartIndependentAgent,
  mockGetIndependentDefinitionPluginId,
  mockRegisterScript,
  mockRegisterStylesheet,
  mockAppGet,
  mockAppPost,
  mockRegisterDatabaseModels,
  mockOnDatabaseReady,
} = vi.hoisted(() => ({
  mockGetIndependentInstances: vi.fn(() => []),
  mockGetIndependentInstance: vi.fn(() => undefined),
  mockCancelBySession: vi.fn(),
  mockPauseIndependentAgent: vi.fn(),
  mockResumeIndependentAgent: vi.fn(),
  mockSuspendIndependentAgent: vi.fn(),
  mockFreezeAllIndependentAgents: vi.fn(() => new Map()),
  mockThawIndependentAgent: vi.fn(),
  mockStartIndependentAgent: vi.fn(),
  mockGetIndependentDefinitionPluginId: vi.fn(() => undefined),
  mockRegisterScript: vi.fn(),
  mockRegisterStylesheet: vi.fn(),
  mockAppGet: vi.fn(),
  mockAppPost: vi.fn(),
  mockRegisterDatabaseModels: vi.fn(),
  mockOnDatabaseReady: vi.fn(callback => callback({})),
}));

vi.mock('../../../lib.js', () => ({
  AgentSystem: {
    getIndependentInstances: mockGetIndependentInstances,
    getIndependentInstance: mockGetIndependentInstance,
    cancelBySession: mockCancelBySession,
    pauseIndependentAgent: mockPauseIndependentAgent,
    resumeIndependentAgent: mockResumeIndependentAgent,
    suspendIndependentAgent: mockSuspendIndependentAgent,
    freezeAllIndependentAgents: mockFreezeAllIndependentAgents,
    thawIndependentAgent: mockThawIndependentAgent,
    startIndependentAgent: mockStartIndependentAgent,
    getIndependentDefinitionPluginId: mockGetIndependentDefinitionPluginId,
    reportProgress: vi.fn(),
    returnResult: vi.fn(),
  },
}));

import agentsPlugin from './agents.js';

function createPluginApi() {
  const hookCallbacks: Record<
    string,
    Array<(...args: unknown[]) => Promise<void>>
  > = {
    onUserConversationWillEnd: [],
    onAssistantAcceptsRequests: [],
    onAssistantWillStopAcceptingRequests: [],
  };

  return {
    hookCallbacks,
    api: {
      registerPlugin: async () => ({
        registerTool: vi.fn(),
        logger: { log: vi.fn() },
        request: vi.fn((pluginId: string) => {
          if (pluginId === 'memory') {
            return {
              registerDatabaseModels: mockRegisterDatabaseModels,
              onDatabaseReady: mockOnDatabaseReady,
            };
          }
          return {
            express: {
              get: mockAppGet,
              post: mockAppPost,
            },
            registerScript: mockRegisterScript,
            registerStylesheet: mockRegisterStylesheet,
          };
        }),
        hooks: {
          onUserConversationWillEnd: vi.fn(callback => {
            hookCallbacks.onUserConversationWillEnd.push(callback);
          }),
          onAssistantAcceptsRequests: vi.fn(callback => {
            hookCallbacks.onAssistantAcceptsRequests.push(callback);
          }),
          onAssistantWillStopAcceptingRequests: vi.fn(callback => {
            hookCallbacks.onAssistantWillStopAcceptingRequests.push(callback);
          }),
        },
      }),
    },
  };
}

describe('agents plugin', () => {
  beforeEach(() => {
    mockGetIndependentInstances.mockReset().mockReturnValue([]);
    mockGetIndependentInstance.mockReset().mockReturnValue(undefined);
    mockCancelBySession.mockReset();
    mockPauseIndependentAgent.mockReset();
    mockResumeIndependentAgent.mockReset();
    mockSuspendIndependentAgent.mockReset();
    mockFreezeAllIndependentAgents.mockReset().mockReturnValue(new Map());
    mockThawIndependentAgent.mockReset();
    mockStartIndependentAgent.mockReset();
    mockGetIndependentDefinitionPluginId.mockReset().mockReturnValue(undefined);
    mockRegisterScript.mockReset();
    mockRegisterStylesheet.mockReset();
    mockAppGet.mockReset();
    mockAppPost.mockReset();
    mockRegisterDatabaseModels.mockReset();
    mockOnDatabaseReady
      .mockReset()
      .mockImplementation(callback => callback({}));
  });

  it('registers the independent agents API route and page assets', async () => {
    const { api, hookCallbacks } = createPluginApi();

    await agentsPlugin.registerPlugin(api as never);

    expect(hookCallbacks.onAssistantAcceptsRequests).toHaveLength(1);

    await hookCallbacks.onAssistantAcceptsRequests[0]();

    expect(mockAppGet).toHaveBeenCalledWith(
      '/api/agents/independent',
      expect.any(Function)
    );
    expect(mockRegisterScript).toHaveBeenCalledWith(
      expect.stringContaining('independent-agents-web-ui.js')
    );
    expect(mockRegisterStylesheet).toHaveBeenCalledWith(
      expect.stringContaining('independent-agents-web-ui.css')
    );
  });

  it('registers the AgentsCheckpoint entity with the memory plugin', async () => {
    const { api } = createPluginApi();
    await agentsPlugin.registerPlugin(api as never);

    expect(mockRegisterDatabaseModels).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Function)])
    );
  });

  it('serializes independent agent state from the runtime', async () => {
    mockGetIndependentInstances.mockReturnValue([
      {
        instanceId: 'instance-1',
        agentId: 'agent-1',
        agentName: 'Agent One',
        description: 'Test agent.',
        conversationType: 'autonomy',
        status: 'sleeping',
        statusMessage: 'No work queued.',
        startedAt: new Date('2026-04-16T10:00:00.000Z'),
        updatedAt: new Date('2026-04-16T10:05:00.000Z'),
        lastActivityAt: new Date('2026-04-16T10:04:00.000Z'),
        lastStateChangeAt: new Date('2026-04-16T10:02:00.000Z'),
      },
    ]);

    const { api, hookCallbacks } = createPluginApi();
    await agentsPlugin.registerPlugin(api as never);
    await hookCallbacks.onAssistantAcceptsRequests[0]();

    const routeHandler = mockAppGet.mock.calls.find(
      ([route]) => route === '/api/agents/independent'
    )?.[1];

    const json = vi.fn();
    const status = vi.fn(() => ({ json }));

    await routeHandler?.({}, { json, status });

    expect(json).toHaveBeenCalledWith({
      agents: [
        {
          instanceId: 'instance-1',
          agentId: 'agent-1',
          agentName: 'Agent One',
          description: 'Test agent.',
          conversationType: 'autonomy',
          status: 'sleeping',
          statusMessage: 'No work queued.',
          startedAt: '2026-04-16T10:00:00.000Z',
          updatedAt: '2026-04-16T10:05:00.000Z',
          lastActivityAt: '2026-04-16T10:04:00.000Z',
          lastStateChangeAt: '2026-04-16T10:02:00.000Z',
        },
      ],
    });
    expect(status).not.toHaveBeenCalled();
  });

  it('registers supervision API endpoints (pause, resume, suspend)', async () => {
    const { api, hookCallbacks } = createPluginApi();
    await agentsPlugin.registerPlugin(api as never);
    await hookCallbacks.onAssistantAcceptsRequests[0]();

    expect(mockAppPost).toHaveBeenCalledWith(
      '/api/agents/independent/:agentId/pause',
      expect.any(Function)
    );
    expect(mockAppPost).toHaveBeenCalledWith(
      '/api/agents/independent/:agentId/resume',
      expect.any(Function)
    );
    expect(mockAppPost).toHaveBeenCalledWith(
      '/api/agents/independent/:agentId/suspend',
      expect.any(Function)
    );
  });

  it('pause endpoint calls pauseIndependentAgent and returns updated state', async () => {
    const pausedInstance = {
      agentId: 'agent-1',
      status: 'paused',
      statusMessage: 'Paused by supervisor.',
    };
    mockPauseIndependentAgent.mockResolvedValue(undefined);
    mockGetIndependentInstance.mockReturnValue(pausedInstance);

    const { api, hookCallbacks } = createPluginApi();
    await agentsPlugin.registerPlugin(api as never);
    await hookCallbacks.onAssistantAcceptsRequests[0]();

    const pauseHandler = mockAppPost.mock.calls.find(
      ([route]) => route === '/api/agents/independent/:agentId/pause'
    )?.[1];

    const json = vi.fn();
    const statusFn = vi.fn(() => ({ json }));
    await pauseHandler?.(
      { params: { agentId: 'agent-1' } },
      { json, status: statusFn }
    );

    expect(mockPauseIndependentAgent).toHaveBeenCalledWith('agent-1');
    expect(json).toHaveBeenCalledWith({
      agentId: 'agent-1',
      status: 'paused',
      statusMessage: 'Paused by supervisor.',
    });
  });

  it('suspend endpoint calls suspendIndependentAgent for stuck agent', async () => {
    const suspendedInstance = {
      agentId: 'agent-2',
      status: 'sleeping',
      statusMessage: 'Suspended by supervisor.',
    };
    mockSuspendIndependentAgent.mockResolvedValue(undefined);
    mockGetIndependentInstance.mockReturnValue(suspendedInstance);

    const { api, hookCallbacks } = createPluginApi();
    await agentsPlugin.registerPlugin(api as never);
    await hookCallbacks.onAssistantAcceptsRequests[0]();

    const suspendHandler = mockAppPost.mock.calls.find(
      ([route]) => route === '/api/agents/independent/:agentId/suspend'
    )?.[1];

    const json = vi.fn();
    const statusFn = vi.fn(() => ({ json }));
    await suspendHandler?.(
      { params: { agentId: 'agent-2' } },
      { json, status: statusFn }
    );

    expect(mockSuspendIndependentAgent).toHaveBeenCalledWith('agent-2');
    expect(json).toHaveBeenCalledWith({
      agentId: 'agent-2',
      status: 'sleeping',
      statusMessage: 'Suspended by supervisor.',
    });
  });
});
