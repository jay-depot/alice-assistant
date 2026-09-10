import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLlmProviderRegistry,
  registerLlmProvider,
  registerLlmUseFor,
  resolveLlmProviderForRequest,
  resolveLlmProviderForRequestAsync,
} from './llm-provider.js';
import type { SystemConfigFull } from './types/system-config-full.js';

function makeBaseConfig(
  models: SystemConfigFull['llm']['models']
): SystemConfigFull {
  return {
    wakeWord: 'hey alice',
    assistantName: 'Alice',
    webInterface: {
      enabled: true,
      port: 47153,
      bindToAddress: '127.0.0.1',
    },
    llm: {
      models,
    },
    piperTts: {
      host: 'http://127.0.0.1:5000',
      model: 'en_US-lessac-medium',
      speaker: 0,
    },
    openWakeWord: {
      model: 'alexa',
    },
  } as SystemConfigFull;
}

describe('llm-provider routing', () => {
  beforeEach(() => {
    clearLlmProviderRegistry();
  });

  it('falls back to fallback model by default', () => {
    registerLlmProvider({
      id: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
    });

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
    ]);

    const active = resolveLlmProviderForRequest(config, {});
    expect(active.resolvedUseFor).toBe('fallback');
    expect(active.model.model).toBe('llama3.1');
  });

  it('throws a clear error when no vision model is configured and the fallback is not vision-capable', async () => {
    registerLlmProvider({
      id: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
    });

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
    ]);

    await expect(
      resolveLlmProviderForRequestAsync(config, {
        requestedUseFor: 'vision',
        hasVisionInput: true,
      })
    ).rejects.toThrow(
      /no vision model is configured and fallback model ollama:llama3.1 does not support vision/i
    );
  });

  it('throws a clear error when vision input resolves to a non-vision fallback', async () => {
    registerLlmProvider({
      id: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
    });

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
    ]);

    await expect(
      resolveLlmProviderForRequestAsync(config, {
        requestedUseFor: 'fallback',
        hasVisionInput: true,
      })
    ).rejects.toThrow(
      /fallback model ollama:llama3.1 does not support vision/i
    );
  });

  it('throws a clear error when configured vision route is not vision-capable', async () => {
    registerLlmProvider({
      id: 'openrouter',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
    });

    registerLlmUseFor({
      id: 'vision',
      description: 'Image understanding route.',
      qualifies: () => false,
    });

    const config = makeBaseConfig([
      {
        provider: 'openrouter',
        useFor: 'fallback',
        model: 'qwen/qwen3-8b:free',
        supportsVision: false,
      },
      {
        provider: 'openrouter',
        useFor: 'vision',
        model: 'qwen/qwen3-vl-8b:free',
        supportsVision: false,
      },
    ]);

    await expect(
      resolveLlmProviderForRequestAsync(config, {
        requestedUseFor: 'vision',
        hasVisionInput: true,
      })
    ).rejects.toThrow(/useFor=vision configuration/i);
  });

  it('allows vision requests to use fallback when fallback supports vision', async () => {
    registerLlmProvider({
      id: 'openrouter',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
      getModelProperties: async () => ({
        supportsVision: true,
      }),
    });

    const config = makeBaseConfig([
      {
        provider: 'openrouter',
        useFor: 'fallback',
        model: 'qwen/qwen3-vl-8b:free',
        supportsVision: true,
      },
    ]);

    const active = await resolveLlmProviderForRequestAsync(config, {
      requestedUseFor: 'vision',
      hasVisionInput: true,
    });

    expect(active.model.useFor).toBe('fallback');
    expect(active.model.model).toBe('qwen/qwen3-vl-8b:free');
    expect(active.properties?.supportsVision).toBe(true);
  });

  it('supports qualifier-driven route selection for plugin-defined useFor', () => {
    registerLlmProvider({
      id: 'openrouter',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
    });

    registerLlmUseFor({
      id: 'vision',
      description: 'Image understanding route.',
      priority: 10,
      qualifies: context =>
        context.latestUserMessage?.includes('[image]') ?? false,
    });

    const config = makeBaseConfig([
      {
        provider: 'openrouter',
        useFor: 'fallback',
        model: 'qwen/qwen3-8b:free',
        supportsVision: false,
      },
      {
        provider: 'openrouter',
        useFor: 'vision',
        model: 'qwen/qwen3-vl-8b:free',
        supportsVision: true,
      },
    ]);

    const active = resolveLlmProviderForRequest(config, {
      latestUserMessage: 'please inspect this [image]',
      hasVisionInput: true,
    });

    expect(active.resolvedUseFor).toBe('vision');
    expect(active.model.model).toBe('qwen/qwen3-vl-8b:free');
  });

  // ── Tiered routing tests ──────────────────────────────────────────

  it('resolves conversationType=chat to useFor=chat when chat route is configured', () => {
    registerLlmProvider({
      id: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
    });

    registerLlmUseFor({
      id: 'chat',
      description: 'Chat conversations.',
      qualifies: context => context.conversationType === 'chat',
    });

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
      {
        provider: 'ollama',
        useFor: 'chat',
        model: 'mistral-small',
        host: 'http://127.0.0.1:11434',
      },
    ]);

    const active = resolveLlmProviderForRequest(config, {
      conversationType: 'chat',
    });
    expect(active.resolvedUseFor).toBe('chat');
    expect(active.model.model).toBe('mistral-small');
  });

  it('resolves conversationType=voice to useFor=voice when voice route is configured', () => {
    registerLlmProvider({
      id: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
    });

    registerLlmUseFor({
      id: 'voice',
      description: 'Voice conversations.',
      qualifies: context => context.conversationType === 'voice',
    });

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
      {
        provider: 'ollama',
        useFor: 'voice',
        model: 'ministral',
        host: 'http://127.0.0.1:11434',
      },
    ]);

    const active = resolveLlmProviderForRequest(config, {
      conversationType: 'voice',
    });
    expect(active.resolvedUseFor).toBe('voice');
    expect(active.model.model).toBe('ministral');
  });

  it('falls through to fallback when medium has no configured model', () => {
    registerLlmProvider({
      id: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
    });

    registerLlmUseFor({
      id: 'chat',
      description: 'Chat conversations.',
      qualifies: context => context.conversationType === 'chat',
    });

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
    ]);

    const active = resolveLlmProviderForRequest(config, {
      conversationType: 'chat',
    });
    expect(active.resolvedUseFor).toBe('fallback');
    expect(active.model.model).toBe('llama3.1');
  });

  it('task-tier vision beats medium-tier chat when vision input is present', () => {
    registerLlmProvider({
      id: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
    });

    registerLlmUseFor({
      id: 'vision',
      tier: 'task',
      description: 'Vision route.',
      qualifies: context => context.hasVisionInput === true,
    });

    registerLlmUseFor({
      id: 'chat',
      description: 'Chat route.',
      qualifies: context => context.conversationType === 'chat',
    });

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
      {
        provider: 'ollama',
        useFor: 'vision',
        model: 'llava',
        host: 'http://127.0.0.1:11434',
        supportsVision: true,
      },
      {
        provider: 'ollama',
        useFor: 'chat',
        model: 'mistral-small',
        host: 'http://127.0.0.1:11434',
      },
    ]);

    const active = resolveLlmProviderForRequest(config, {
      conversationType: 'chat',
      hasVisionInput: true,
    });
    expect(active.resolvedUseFor).toBe('vision');
    expect(active.model.model).toBe('llava');
  });

  it('agent-tier deep-research route matches deep-dive-research conversation type', () => {
    registerLlmProvider({
      id: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
    });

    registerLlmUseFor({
      id: 'deep-research',
      tier: 'agent',
      description: 'Deep research route.',
      qualifies: context => context.conversationType === 'deep-dive-research',
    });

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
      {
        provider: 'ollama',
        useFor: 'deep-research',
        model: 'qwen3:32b',
        host: 'http://127.0.0.1:11434',
      },
    ]);

    const active = resolveLlmProviderForRequest(config, {
      conversationType: 'deep-dive-research',
    });
    expect(active.resolvedUseFor).toBe('deep-research');
    expect(active.model.model).toBe('qwen3:32b');
  });

  it('agent-tier deep-research route takes priority over medium-tier autonomy', () => {
    registerLlmProvider({
      id: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
    });

    registerLlmUseFor({
      id: 'deep-research',
      tier: 'agent',
      description: 'Deep research route.',
      qualifies: context => context.conversationType === 'deep-dive-research',
    });

    registerLlmUseFor({
      id: 'autonomy',
      description: 'Autonomy route.',
      qualifies: context => context.conversationType === 'autonomy',
    });

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
      {
        provider: 'ollama',
        useFor: 'deep-research',
        model: 'qwen3:32b',
        host: 'http://127.0.0.1:11434',
      },
      {
        provider: 'ollama',
        useFor: 'autonomy',
        model: 'granite',
        host: 'http://127.0.0.1:11434',
      },
    ]);

    const active = resolveLlmProviderForRequest(config, {
      conversationType: 'deep-dive-research',
    });
    expect(active.resolvedUseFor).toBe('deep-research');
    expect(active.model.model).toBe('qwen3:32b');
  });
});

// ── Async model-property resolution (getModelProperties) ───────────

describe('llm-provider async model properties', () => {
  beforeEach(() => {
    clearLlmProviderRegistry();
  });

  function registerTestProvider(
    getModelProperties?: (model: unknown) => Promise<{
      supportsVision: boolean;
      contextWindow?: number;
    }>
  ): void {
    registerLlmProvider({
      id: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      chat: async () => ({
        message: { role: 'assistant', content: 'ok' },
      }),
      ...(getModelProperties ? { getModelProperties } : {}),
    });
  }

  function fallbackPlusVisionConfig(): SystemConfigFull {
    return makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
      {
        provider: 'ollama',
        useFor: 'vision',
        model: 'glm-5.3-flash:cloud',
        host: 'http://127.0.0.1:11434',
      },
    ]);
  }

  it('uses detected vision support and attaches detected properties', async () => {
    registerTestProvider(async model => {
      expect((model as { model: string }).model).toBe('glm-5.3-flash:cloud');
      return { supportsVision: true, contextWindow: 1048576 };
    });

    const active = await resolveLlmProviderForRequestAsync(
      fallbackPlusVisionConfig(),
      { requestedUseFor: 'vision', hasVisionInput: true }
    );

    expect(active.model.model).toBe('glm-5.3-flash:cloud');
    expect(active.properties).toStrictEqual({
      supportsVision: true,
      contextWindow: 1048576,
    });
  });

  it('explicit config supportsVision: false beats detected true', async () => {
    registerTestProvider(async () => ({ supportsVision: true }));

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
      {
        provider: 'ollama',
        useFor: 'vision',
        model: 'glm-5.3-flash:cloud',
        host: 'http://127.0.0.1:11434',
        supportsVision: false,
      },
    ]);

    await expect(
      resolveLlmProviderForRequestAsync(config, {
        requestedUseFor: 'vision',
        hasVisionInput: true,
      })
    ).rejects.toThrow(/useFor=vision configuration/i);
  });

  it('explicit config supportsVision: true beats detected false', async () => {
    registerTestProvider(async () => ({ supportsVision: false }));

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
        supportsVision: true,
      },
    ]);

    const active = await resolveLlmProviderForRequestAsync(config, {
      requestedUseFor: 'fallback',
      hasVisionInput: true,
    });
    expect(active.resolvedUseFor).toBe('fallback');
  });

  it('warns and defaults to false on detection failure without caching it', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let detectionCalls = 0;
    registerTestProvider(async () => {
      detectionCalls += 1;
      if (detectionCalls === 1) {
        throw new Error('ollama server unreachable');
      }
      return { supportsVision: true };
    });

    const config = makeBaseConfig([
      {
        provider: 'ollama',
        useFor: 'fallback',
        model: 'llama3.1',
        host: 'http://127.0.0.1:11434',
      },
    ]);

    const first = await resolveLlmProviderForRequestAsync(config, {});
    expect(first.properties).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0].join(' ')).toContain(
      'ollama server unreachable'
    );

    const second = await resolveLlmProviderForRequestAsync(config, {});
    expect(second.properties?.supportsVision).toBe(true);
    expect(detectionCalls).toBe(2);

    warnSpy.mockRestore();
  });
});
