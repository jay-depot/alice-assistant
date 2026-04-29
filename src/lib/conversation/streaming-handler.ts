import type { ChatResponse, ToolCall } from 'ollama';
import type { AbortableAsyncIterator } from 'ollama';
import type { ConversationStreamingCallbacks } from './types.js';

export type StreamingResult = {
  content: string;
  thinking: string;
  toolCalls: ToolCall[];
};

/**
 * Iterates over a streaming Ollama chat response, accumulating deltas
 * for content, thinking, and tool calls while firing the appropriate
 * callbacks after each chunk.
 */
export async function iterateStream(
  streamIterator: AbortableAsyncIterator<ChatResponse>,
  callbacks: ConversationStreamingCallbacks
): Promise<StreamingResult> {
  let content = '';
  let thinking = '';
  let toolCalls: ToolCall[] = [];

  try {
    for await (const chunk of streamIterator) {
      const deltaThinking = chunk.message.thinking ?? '';
      const deltaContent = chunk.message.content ?? '';
      const deltaToolCalls = chunk.message.tool_calls;

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
