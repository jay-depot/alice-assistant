import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AlicePluginInterface } from '../../../lib.js';
import type { LlmProviderRegistration } from '../../../lib/llm-provider.js';
import ollamaProviderPlugin from './ollama-provider.js';
import { isCloudModelTag, toOllamaImages } from './ollama-provider.js';

// Holder for the per-test client instance. vi.hoisted so the vi.mock factory
// below can close over it before the test module body runs.
const ollamaClient = vi.hoisted(() => ({
  current: null as null | {
    show: ReturnType<typeof vi.fn>;
    chat: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('ollama', () => {
  // The provider constructs clients with `new Ollama(...)` — the mock must be
  // constructible and delegate to the current per-test client instance.
  class MockOllama {
    show: ReturnType<typeof vi.fn>;
    chat: ReturnType<typeof vi.fn>;

    constructor() {
      if (!ollamaClient.current) {
        throw new Error('ollama client mock not initialised for this test');
      }
      this.show = ollamaClient.current.show;
      this.chat = ollamaClient.current.chat;
    }
  }

  return { default: MockOllama, Ollama: MockOllama };
});

function imageDataUrl(base64: string): string {
  return `data:image/png;base64,${base64}`;
}

function ollamaModel(model: string, options?: Record<string, unknown>) {
  return {
    provider: 'ollama' as const,
    useFor: 'fallback',
    host: 'http://127.0.0.1:11434',
    model,
    ...(options ? { options } : {}),
  };
}

/**
 * Mock plugin interface for testing plugin registration. Captures the
 * LlmProviderRegistration handed to the llm-provider-broker.
 */
function createMockPluginInterface() {
  const brokerCapture = { registerLlmProvider: vi.fn() };
  return {
    brokerCapture,
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
      offer: vi.fn(),
      request: vi.fn(() => ({
        registerLlmProvider: brokerCapture.registerLlmProvider,
      })),
    }),
  };
}

describe('ollamaProviderPlugin', () => {
  let registration: LlmProviderRegistration;
  let client: {
    show: ReturnType<typeof vi.fn>;
    chat: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    client = { show: vi.fn(), chat: vi.fn() };
    ollamaClient.current = client;
    const mockInterface = createMockPluginInterface();
    await ollamaProviderPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(
      mockInterface.brokerCapture.registerLlmProvider
    ).toHaveBeenCalledTimes(1);
    registration =
      mockInterface.brokerCapture.registerLlmProvider.mock.calls[0][0];
  });

  it('has correct plugin metadata', () => {
    expect(ollamaProviderPlugin.pluginMetadata).toMatchObject({
      id: 'ollama-provider',
      required: true,
      dependencies: [{ id: 'llm-provider-broker', version: 'LATEST' }],
    });
  });

  it('declares transport-level vision support', () => {
    // Per-model vision support is detected async via getModelProperties; the
    // provider-level flag only asserts the transport can carry images.
    expect(registration.capabilities.supportsVision).toBe(true);
    expect(typeof registration.getModelProperties).toBe('function');
  });

  describe('isCloudModelTag', () => {
    it('matches plain cloud tags', () => {
      expect(isCloudModelTag('glm-5.3-flash:cloud')).toBe(true);
    });

    it('matches suffixed cloud tags', () => {
      expect(isCloudModelTag('mistral-large-3:675b-cloud')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isCloudModelTag('qwen3:CLOUD')).toBe(true);
    });

    it('does not match local model names', () => {
      expect(isCloudModelTag('glm-5.3-flash')).toBe(false);
      expect(isCloudModelTag('llava13b:latest')).toBe(false);
    });
  });

  describe('toOllamaImages', () => {
    it('strips the data URL prefix to raw base64', () => {
      expect(
        toOllamaImages([
          { mimeType: 'image/png', dataUrl: imageDataUrl('AAAA') },
        ])
      ).toEqual(['AAAA']);
    });

    it('returns undefined for empty or missing image lists', () => {
      expect(toOllamaImages(undefined)).toBeUndefined();
      expect(toOllamaImages([])).toBeUndefined();
    });

    it('drops malformed entries that are not data URLs', () => {
      expect(
        toOllamaImages([
          { mimeType: 'image/png', dataUrl: imageDataUrl('AAAA') },
          { mimeType: 'image/png', dataUrl: 'not-a-data-url' },
        ])
      ).toEqual(['AAAA']);
    });

    it('returns undefined when no usable images remain', () => {
      expect(
        toOllamaImages([{ mimeType: 'image/png', dataUrl: 'garbage' }])
      ).toBeUndefined();
    });
  });

  describe('chat request options (num_ctx)', () => {
    beforeEach(() => {
      (client as { chat: ReturnType<typeof vi.fn> }).chat.mockResolvedValue({
        message: { role: 'assistant', content: 'ok' },
      });
    });

    it('keeps the 36000 protective default for local models with no num_ctx', async () => {
      await registration.chat(
        { messages: [{ role: 'user', content: 'hi' }] },
        ollamaModel('llava13b')
      );

      const request = (client as { chat: ReturnType<typeof vi.fn> }).chat.mock
        .calls[0][0];
      expect(request.options).toEqual({ num_ctx: 36000 });
    });

    it('omits num_ctx entirely for cloud models with no num_ctx', async () => {
      await registration.chat(
        { messages: [{ role: 'user', content: 'hi' }] },
        ollamaModel('glm-5.3-flash:cloud')
      );

      const request = (client as { chat: ReturnType<typeof vi.fn> }).chat.mock
        .calls[0][0];
      expect(request.options).toEqual({});
      expect(request.options.num_ctx).toBeUndefined();
    });

    it('respects an explicit num_ctx on local models', async () => {
      await registration.chat(
        { messages: [{ role: 'user', content: 'hi' }] },
        ollamaModel('llava13b', { num_ctx: 8192, temperature: 0.7 })
      );

      const request = (client as { chat: ReturnType<typeof vi.fn> }).chat.mock
        .calls[0][0];
      expect(request.options).toEqual({ num_ctx: 8192, temperature: 0.7 });
    });

    it('respects an explicit num_ctx on cloud models', async () => {
      await registration.chat(
        { messages: [{ role: 'user', content: 'hi' }] },
        ollamaModel('glm-5.3-flash:cloud', { num_ctx: 1000000 })
      );

      const request = (client as { chat: ReturnType<typeof vi.fn> }).chat.mock
        .calls[0][0];
      expect(request.options).toEqual({ num_ctx: 1000000 });
    });

    it('passes images as raw base64 without the data URL prefix', async () => {
      await registration.chat(
        {
          messages: [
            {
              role: 'user',
              content: 'What is in this image?',
              images: [
                { mimeType: 'image/png', dataUrl: imageDataUrl('QUJD') },
              ],
            },
          ],
        },
        ollamaModel('glm-5.3-flash:cloud')
      );

      const request = (client as { chat: ReturnType<typeof vi.fn> }).chat.mock
        .calls[0][0];
      expect(request.messages[0].images).toEqual(['QUJD']);
    });
  });

  describe('getModelProperties', () => {
    it('parses vision capability and arch-prefixed context length for cloud models', async () => {
      (client as { show: ReturnType<typeof vi.fn> }).show.mockResolvedValue({
        capabilities: ['completion', 'thinking', 'tools', 'vision'],
        model_info: {
          'general.architecture': 'glm5_next',
          'glm5_next.context_length': 1048576,
        },
      });

      await expect(
        registration.getModelProperties!(ollamaModel('glm-5.3-flash:cloud'))
      ).resolves.toStrictEqual({
        supportsVision: true,
        contextWindow: 1048576,
      });
    });

    it('reports no vision capability when absent from capabilities', async () => {
      (client as { show: ReturnType<typeof vi.fn> }).show.mockResolvedValue({
        capabilities: ['completion'],
        model_info: {},
      });

      await expect(
        registration.getModelProperties!(ollamaModel('qwen2:text-only'))
      ).resolves.toStrictEqual({ supportsVision: false });
    });

    it('does not expose contextWindow for local models even when detected', async () => {
      // The GGUF maximum overstates the usable local KV-cache budget, so the
      // detected length is intentionally not surfaced for local models.
      (client as { show: ReturnType<typeof vi.fn> }).show.mockResolvedValue({
        capabilities: ['completion', 'vision'],
        model_info: { 'llama.context_length': 131072 },
      });

      await expect(
        registration.getModelProperties!(ollamaModel('llava13b'))
      ).resolves.toStrictEqual({ supportsVision: true });
    });

    it('rejects mismatched provider model configs', async () => {
      await expect(
        registration.getModelProperties!({
          provider: 'openrouter',
          useFor: 'fallback',
          model: 'anthropic/claude',
        } as Parameters<
          LlmProviderRegistration['getModelProperties']
        >['0'] as never)
      ).rejects.toThrow(/mismatched model config/i);
    });

    it('serves repeated calls from cache within the TTL', async () => {
      vi.useFakeTimers();
      try {
        const showMock = client as { show: ReturnType<typeof vi.fn> };
        showMock.show.mockResolvedValue({
          capabilities: ['vision'],
          model_info: { 'glm5_next.context_length': 1048576 },
        });

        const model = ollamaModel('glm-5.3-flash:ttl-cloud');
        await registration.getModelProperties!(model);
        expect(showMock.show).toHaveBeenCalledTimes(1);

        // Still inside the TTL: cached value, no extra show() call.
        vi.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);
        await expect(
          registration.getModelProperties!(model)
        ).resolves.toStrictEqual({
          supportsVision: true,
          contextWindow: 1048576,
        });
        expect(showMock.show).toHaveBeenCalledTimes(1);

        // Past the TTL: fresh detection.
        vi.advanceTimersByTime(2 * 1000);
        showMock.show.mockResolvedValue({
          capabilities: [],
          model_info: { 'glm5_next.context_length': 1048576 },
        });
        await expect(
          registration.getModelProperties!(model)
        ).resolves.toStrictEqual({
          supportsVision: false,
          contextWindow: 1048576,
        });
        expect(showMock.show).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('deduplicates concurrent detections into one show() call', async () => {
      const showMock = client as { show: ReturnType<typeof vi.fn> };
      let resolveShow!: (value: unknown) => void;
      showMock.show.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveShow = resolve;
          })
      );

      const model = ollamaModel('glm-5.3-flash:dedupe-cloud');
      const first = registration.getModelProperties!(model);
      const second = registration.getModelProperties!(model);
      expect(showMock.show).toHaveBeenCalledTimes(1);

      resolveShow({
        capabilities: ['vision'],
        model_info: { 'glm5_next.context_length': 1000 },
      });
      const expected = { supportsVision: true, contextWindow: 1000 };
      await expect(first).resolves.toStrictEqual(expected);
      await expect(second).resolves.toStrictEqual(expected);
    });

    it('never caches detection failures — the next request retries', async () => {
      const showMock = client as { show: ReturnType<typeof vi.fn> };
      const model = ollamaModel('glm-5.3-flash:failing');

      showMock.show.mockRejectedValueOnce(new Error('ollama server down'));
      await expect(registration.getModelProperties!(model)).rejects.toThrow(
        'ollama server down'
      );

      showMock.show.mockResolvedValue({
        capabilities: ['vision'],
        model_info: {},
      });
      await expect(
        registration.getModelProperties!(model)
      ).resolves.toStrictEqual({ supportsVision: true });
      expect(showMock.show).toHaveBeenCalledTimes(2);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
