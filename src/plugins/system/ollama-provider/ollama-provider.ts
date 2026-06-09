import {
  type ChatResponse,
  Ollama,
  type Tool as OllamaRequestTool,
  type ToolCall,
} from 'ollama';
import type { AbortableAsyncIterator } from 'ollama';
import { AlicePlugin } from '../../../lib.js';
import type {
  LlmChatResponse,
  LlmModelConfig,
  LlmMessage,
  LlmProviderRegistration,
  LlmStreamChunk,
  LlmToolCall,
  OllamaLlmModelConfig,
} from '../../../lib/llm-provider.js';

type OllamaMessage = {
  role: string;
  content: string;
  thinking?: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
};

function normalizeToolCall(toolCall: ToolCall): LlmToolCall {
  return {
    id:
      'id' in toolCall && typeof toolCall.id === 'string'
        ? toolCall.id
        : undefined,
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    },
  };
}

function normalizeResponse(message: ChatResponse['message']): LlmMessage {
  return {
    role: message.role,
    content: message.content || '',
    reasoning: message.thinking,
    tool_calls: message.tool_calls?.map(normalizeToolCall),
  };
}

function toOllamaMessage(message: LlmMessage): OllamaMessage {
  return {
    role: message.role,
    content: message.content,
    thinking: message.reasoning,
    tool_calls: message.tool_calls?.map(toolCall => ({
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
    })),
    tool_name: message.tool_name,
  };
}

function assertOllamaModel(
  model: LlmModelConfig
): asserts model is OllamaLlmModelConfig {
  if (model.provider !== 'ollama') {
    throw new Error(
      `Ollama provider received mismatched model config for provider "${model.provider}".`
    );
  }
}

function createOllamaClient(model: OllamaLlmModelConfig): Ollama {
  return new Ollama({ host: model.host });
}

const ollamaProviderPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'ollama-provider',
    name: 'Ollama Provider',
    brandColor: '#5bd16a',
    description:
      'Registers Ollama as the default local LLM provider for chat, streaming, and tool calling.',
    version: 'LATEST',
    dependencies: [{ id: 'llm-provider-broker', version: 'LATEST' }],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const broker = plugin.request('llm-provider-broker');
    if (!broker) {
      throw new Error(
        'Ollama Provider: LLM provider broker API is unavailable. Disable ollama-provider or fix llm-provider-broker first.'
      );
    }

    const providerRegistration: LlmProviderRegistration = {
      id: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      buildToolDefinitions: definitions =>
        definitions.map(definition => ({
          type: 'function',
          function: {
            name: definition.name,
            description: definition.description,
            parameters: definition.parameters,
          },
        })),
      chat: async (request, model) => {
        assertOllamaModel(model);
        const client = createOllamaClient(model);
        const response = await client.chat({
          model: model.model,
          options: {
            num_ctx: 36000,
            ...model.options,
          },
          messages: request.messages.map(toOllamaMessage),
          tools: request.tools as OllamaRequestTool[] | undefined,
        });

        return {
          message: normalizeResponse(response.message),
        } satisfies LlmChatResponse;
      },
      chatStream: async (request, model) => {
        assertOllamaModel(model);
        const client = createOllamaClient(model);
        const response = (await client.chat({
          model: model.model,
          options: {
            num_ctx: 36000,
            ...model.options,
          },
          messages: request.messages.map(toOllamaMessage),
          tools: request.tools as OllamaRequestTool[] | undefined,
          stream: true,
        })) as AbortableAsyncIterator<ChatResponse>;

        async function* iterate(): AsyncIterable<LlmStreamChunk> {
          for await (const chunk of response) {
            yield {
              message: {
                content: chunk.message.content || '',
                reasoning: chunk.message.thinking,
                tool_calls: chunk.message.tool_calls?.map(normalizeToolCall),
              },
              done: chunk.done,
            };

            if (chunk.done) {
              break;
            }
          }
        }

        return iterate();
      },
    };

    plugin.logger.log('registerPlugin: Registering Ollama provider.');
    broker.registerLlmProvider(providerRegistration);
    plugin.logger.log('registerPlugin: Ollama provider registered.');
  },
};

export default ollamaProviderPlugin;
