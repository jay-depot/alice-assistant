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
      ollama: {
        host: 'http://localhost:11434',
        model: 'test-model',
        options: {},
      },
    }),
  },
}));

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
  buildOllamaToolDescriptionObject: vi.fn().mockReturnValue([]),
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
