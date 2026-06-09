import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatResponse } from 'ollama';

vi.mock('ollama', () => ({
  default: {
    chat: vi.fn(),
  },
}));

vi.mock('./user-config.js', () => ({
  UserConfig: {
    getConfig: vi.fn().mockReturnValue({
      llm: {
        models: [
          {
            provider: 'ollama',
            useFor: 'fallback',
            host: 'http://localhost:11434',
            model: 'test-model',
            options: {},
          },
        ],
      },
    }),
  },
}));

vi.mock('./llm-provider.js', async () => {
  const actual =
    await vi.importActual<typeof import('./llm-provider.js')>(
      './llm-provider.js'
    );

  return {
    ...actual,
    getApproximateContextWindow: vi.fn().mockReturnValue(36000),
    getActiveLlmProvider: vi.fn().mockReturnValue({
      model: {
        provider: 'ollama',
        useFor: 'fallback',
        host: 'http://localhost:11434',
        model: 'test-model',
        options: {},
      },
      provider: {
        id: 'ollama',
        capabilities: {
          supportsStreaming: true,
          supportsTools: true,
          supportsVision: false,
        },
        buildToolDefinitions: vi.fn(definitions => definitions),
        chat: vi.fn(async request => {
          const OllamaClient = (await import('ollama')).default;
          return (await OllamaClient.chat({
            model: 'test-model',
            messages: request.messages,
          })) as Awaited<ReturnType<typeof OllamaClient.chat>>;
        }),
        chatStream: vi.fn(async request => {
          const OllamaClient = (await import('ollama')).default;
          return (await OllamaClient.chat({
            model: 'test-model',
            messages: request.messages,
            stream: true,
          })) as AsyncIterable<unknown>;
        }),
      },
    }),
    resolveLlmProviderForRequest: vi.fn().mockReturnValue({
      model: {
        provider: 'ollama',
        useFor: 'fallback',
        host: 'http://localhost:11434',
        model: 'test-model',
        options: {},
      },
      resolvedUseFor: 'fallback',
      provider: {
        id: 'ollama',
        capabilities: {
          supportsStreaming: true,
          supportsTools: true,
          supportsVision: false,
        },
        buildToolDefinitions: vi.fn(definitions => definitions),
        chat: vi.fn(async request => {
          const OllamaClient = (await import('ollama')).default;
          return (await OllamaClient.chat({
            model: 'test-model',
            messages: request.messages,
          })) as Awaited<ReturnType<typeof OllamaClient.chat>>;
        }),
        chatStream: vi.fn(async request => {
          const OllamaClient = (await import('ollama')).default;
          return (await OllamaClient.chat({
            model: 'test-model',
            messages: request.messages,
            stream: true,
          })) as AsyncIterable<unknown>;
        }),
      },
    }),
  };
});

vi.mock('./plugin-hooks.js', () => ({
  PluginHooks: vi.fn(() => ({})),
  PluginHookInvocations: {
    invokeOnContextCompactionSummariesWillBeDeleted: vi
      .fn()
      .mockResolvedValue(undefined),
    invokeOnUserConversationWillBegin: vi.fn().mockResolvedValue(undefined),
    invokeOnUserConversationWillEnd: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./conversation-types.js', () => ({
  hasConversationType: vi.fn().mockReturnValue(true),
  getConversationTypeDefinition: vi.fn().mockReturnValue({
    maxToolCallDepth: 30,
  }),
}));

vi.mock('./conversation/prompt-assembler.js', () => ({
  assembleFullContext: vi.fn().mockResolvedValue([]),
}));

vi.mock('./tools.js', () => ({
  getTools: vi.fn().mockReturnValue([]),
}));

vi.mock('./tool-system.js', () => ({
  buildLlmToolDefinitions: vi.fn().mockReturnValue([]),
  ToolCallEvents: {
    dispatchToolCallEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./conversation/tool-executor.js', () => ({
  executeTools: vi.fn().mockResolvedValue({
    toolResultMessages: [],
    taintedToolNamesAdded: [],
  }),
}));

describe('Conversation maxToolCallDepth override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows depth above 10 when conversation type override is higher', async () => {
    const { Conversation } = await import('./conversation.js');
    const OllamaClient = (await import('ollama')).default;
    const mockChat = vi.mocked(OllamaClient.chat);

    mockChat.mockResolvedValue({
      message: { role: 'assistant', content: 'done', tool_calls: [] },
    } as ChatResponse);

    const conversation = new Conversation('facet-gardener' as never);

    const response = {
      message: {
        role: 'assistant',
        content: 'making tool calls',
        tool_calls: [
          {
            function: {
              name: 'agentSleep',
              arguments: '{}',
            },
          },
        ],
      },
    } as unknown as ChatResponse;

    await expect(
      (
        conversation as unknown as {
          handleToolCalls: (
            response: ChatResponse,
            depth: number
          ) => Promise<string>;
        }
      ).handleToolCalls(response, 11)
    ).resolves.toBe('done');
  });
});
