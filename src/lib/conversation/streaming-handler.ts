import type { LlmStreamChunk, LlmToolCall } from '../llm-provider.js';
import type { ConversationStreamingCallbacks } from './types.js';

export type StreamingResult = {
  content: string;
  thinking: string;
  toolCalls: LlmToolCall[];
};

/**
 * Iterates over a streaming Ollama chat response, accumulating deltas
 * for content, thinking, and tool calls while firing the appropriate
 * callbacks after each chunk.
 */
export async function iterateStream(
  streamIterator: AsyncIterable<LlmStreamChunk>,
  callbacks: ConversationStreamingCallbacks
): Promise<StreamingResult> {
  let content = '';
  let thinking = '';
  let toolCalls: LlmToolCall[] = [];

  try {
    for await (const chunk of streamIterator) {
      const deltaThinking =
        chunk.message?.reasoning ??
        ('thinking' in (chunk.message ?? {}) &&
        typeof (chunk.message as { thinking?: unknown }).thinking === 'string'
          ? ((chunk.message as { thinking?: string }).thinking ?? '')
          : '');
      const deltaContent = chunk.message?.content ?? '';
      const deltaToolCalls = chunk.message?.tool_calls;

      if (deltaThinking) {
        thinking += deltaThinking;
        callbacks.onThinking(deltaThinking);
      }

      if (deltaContent) {
        content += deltaContent;
        callbacks.onContent(deltaContent);
      }

      if (deltaToolCalls && deltaToolCalls.length > 0) {
        toolCalls = deltaToolCalls;
        callbacks.onToolCalls(deltaToolCalls);
      }

      if (chunk.done) {
        break;
      }
    }
  } catch (err) {
    callbacks.onError(err);
    throw err;
  }

  return { content, thinking, toolCalls };
}
