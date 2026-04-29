import { describe, it, expect, vi } from 'vitest';
import type { ChatResponse } from 'ollama';
import type { AbortableAsyncIterator } from 'ollama';
import { iterateStream } from './streaming-handler.js';
import type { ConversationStreamingCallbacks } from './types.js';

function makeChunk(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    model: 'test',
    created_at: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: '',
    },
    done: false,
    ...overrides,
  } as ChatResponse;
}

// Build a simple async iterator that yields given chunks in order
async function* buildIterator(
  chunks: ChatResponse[]
): AbortableAsyncIterator<ChatResponse> {
  for (const chunk of chunks) {
    yield chunk;
  }
  // TypeScript sees the return type as AsyncGenerator but the consumer
  // expects AbortableAsyncIterator. In practice this works because
  // AbortableAsyncIterator extends AsyncGenerator.
}

describe('iterateStream', () => {
  it('accumulates content from stream chunks', async () => {
    const chunks: ChatResponse[] = [
      makeChunk({ message: { role: 'assistant', content: 'Hello' } }),
      makeChunk({ message: { role: 'assistant', content: ' world' } }),
      makeChunk({ done: true, message: { role: 'assistant', content: '' } }),
    ];

    const callbacks: ConversationStreamingCallbacks = {
      onThinking: vi.fn(),
      onContent: vi.fn(),
      onToolCalls: vi.fn(),
      onError: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await iterateStream(buildIterator(chunks) as any, callbacks);

    expect(result.content).toBe('Hello world');
    expect(result.thinking).toBe('');
    expect(result.toolCalls).toEqual([]);
  });

  it('accumulates thinking deltas separately', async () => {
    const chunks: ChatResponse[] = [
      makeChunk({
        message: { role: 'assistant', content: '', thinking: 'Hmm' },
      }),
      makeChunk({
        message: { role: 'assistant', content: '', thinking: '...' },
      }),
      makeChunk({ done: true, message: { role: 'assistant', content: '' } }),
    ];

    const callbacks: ConversationStreamingCallbacks = {
      onThinking: vi.fn(),
      onContent: vi.fn(),
      onToolCalls: vi.fn(),
      onError: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await iterateStream(buildIterator(chunks) as any, callbacks);

    expect(result.thinking).toBe('Hmm...');
    expect(result.content).toBe('');
    expect(callbacks.onThinking).toHaveBeenCalledTimes(2);
  });

  it('captures tool calls from the final meaningful chunk', async () => {
    const toolCalls = [
      { function: { name: 'search', arguments: { q: 'cats' } } },
    ];

    const chunks: ChatResponse[] = [
      makeChunk({
        message: { role: 'assistant', content: 'Searching...' },
      }),
      makeChunk({
        message: {
          role: 'assistant',
          content: 'Searching...',
          tool_calls: toolCalls,
        },
      }),
      makeChunk({ done: true, message: { role: 'assistant', content: '' } }),
    ];

    const callbacks: ConversationStreamingCallbacks = {
      onThinking: vi.fn(),
      onContent: vi.fn(),
      onToolCalls: vi.fn(),
      onError: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await iterateStream(buildIterator(chunks) as any, callbacks);

    expect(result.toolCalls).toEqual(toolCalls);
  });

  it('fires onError callback when stream throws', async () => {
    async function* errorIterator(): AbortableAsyncIterator<ChatResponse> {
      yield makeChunk({
        message: { role: 'assistant', content: 'starting...' },
      });
      throw new Error('stream broke');
    }

    const callbacks: ConversationStreamingCallbacks = {
      onThinking: vi.fn(),
      onContent: vi.fn(),
      onToolCalls: vi.fn(),
      onError: vi.fn(),
    };

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      iterateStream(errorIterator() as any, callbacks)
    ).rejects.toThrow('stream broke');

    expect(callbacks.onError).toHaveBeenCalled();
  });
});
