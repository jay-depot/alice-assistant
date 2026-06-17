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

import type { AlicePluginInterface } from '../../../lib.js';
import utilsPlugin from './utils.js';

function createMockPluginInterface() {
  const registeredTools: any[] = [];

  return {
    registeredTools,
    registerPlugin: async () => ({
      registerTool: (tool: any) => registeredTools.push(tool),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      request: vi.fn(),
      offer: vi.fn(),
      config: vi.fn(),
      hooks: {
        onAllPluginsLoaded: vi.fn(),
        onAssistantWillAcceptRequests: vi.fn(),
        onAssistantAcceptsRequests: vi.fn(),
        onAssistantWillStopAcceptingRequests: vi.fn(),
        onAssistantStoppedAcceptingRequests: vi.fn(),
        onPluginsWillUnload: vi.fn(),
        onTaskAssistantWillBegin: vi.fn(),
        onTaskAssistantWillEnd: vi.fn(),
        onUserConversationWillBegin: vi.fn(),
        onUserConversationWillEnd: vi.fn(),
        onContextCompactionSummariesWillBeDeleted: vi.fn(),
      },
    }),
  };
}

describe('utilsPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;

  beforeEach(async () => {
    mockInterface = createMockPluginInterface();
    await utilsPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
  });

  it('has expected plugin metadata', () => {
    expect(utilsPlugin.pluginMetadata).toMatchObject({
      id: 'utils',
      name: 'Utils Plugin',
      version: 'LATEST',
      required: false,
    });
  });

  it('registers all expected tools', () => {
    const names = mockInterface.registeredTools.map(tool => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'evaluate_arithmetic',
        'count_words',
        'count_letters',
        'count_characters',
        'count_lines',
        'count_unique_words',
        'count_sentences_paragraphs',
        'spell',
      ])
    );
  });

  it('makes all tools available for chat, voice, autonomy, and startup', () => {
    for (const tool of mockInterface.registeredTools) {
      expect(tool.availableFor).toEqual([
        'chat',
        'voice',
        'autonomy',
        'startup',
      ]);
    }
  });

  it('evaluate_arithmetic returns structured success JSON', async () => {
    const tool = mockInterface.registeredTools.find(
      candidate => candidate.name === 'evaluate_arithmetic'
    );

    const raw = await tool.execute({ expression: '1 + 1 * (12 / 3)' });
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(true);
    expect(parsed.result).toBe(5);
  });

  it('evaluate_arithmetic returns structured error JSON', async () => {
    const tool = mockInterface.registeredTools.find(
      candidate => candidate.name === 'evaluate_arithmetic'
    );

    const raw = await tool.execute({ expression: '2 + apples' });
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('INVALID_TOKEN');
  });

  it('count_letters returns frequency entries', async () => {
    const tool = mockInterface.registeredTools.find(
      candidate => candidate.name === 'count_letters'
    );

    const raw = await tool.execute({ text: 'Hello, hello!' });
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(true);
    expect(parsed.totalLetters).toBe(10);
    expect(parsed.counts.h).toBe(2);
    expect(parsed.counts.e).toBe(2);
    expect(parsed.counts.l).toBe(4);
    expect(parsed.counts.o).toBe(2);
  });

  it('spell returns a JSON array of characters preserving spaces and casing', async () => {
    const tool = mockInterface.registeredTools.find(
      candidate => candidate.name === 'spell'
    );

    const raw = await tool.execute({ word: 'Foo bar Baz' });
    const parsed = JSON.parse(raw);

    expect(parsed).toEqual([
      'F',
      'o',
      'o',
      ' ',
      'b',
      'a',
      'r',
      ' ',
      'B',
      'a',
      'z',
    ]);
  });
});
