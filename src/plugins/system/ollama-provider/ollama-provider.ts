import {
  type ChatResponse,
  Ollama,
  type Tool as OllamaRequestTool,
  type ToolCall,
} from 'ollama';
import type { AbortableAsyncIterator } from 'ollama';
import { AlicePlugin } from '../../../lib.js';
import type {
  LlmImageAttachment,
  LlmChatResponse,
  LlmModelConfig,
  LlmModelProperties,
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
  images?: string[];
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

/** Ollama expects raw base64 per message — strip the data: URL prefix and
 *  drop entries that are not parseable data URLs. Returns undefined when no
 *  usable images remain so the request carries no images field at all. */
export function toOllamaImages(
  images: LlmImageAttachment[] | undefined
): string[] | undefined {
  if (!images || images.length === 0) {
    return undefined;
  }
  const rawBase64 = images
    .map(image => image.dataUrl.split(',')[1])
    .filter((base64): base64 is string => Boolean(base64));
  return rawBase64.length > 0 ? rawBase64 : undefined;
}

function toOllamaMessage(message: LlmMessage): OllamaMessage {
  return {
    role: message.role,
    content: message.content,
    thinking: message.reasoning,
    images: toOllamaImages(message.images),
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

export function isCloudModelTag(model: string): boolean {
  return /cloud$/i.test(model.trim());
}

function buildRequestOptions(
  model: OllamaLlmModelConfig
): Record<string, unknown> {
  const options: Record<string, unknown> = { ...model.options };
  if (options.num_ctx === undefined && !isCloudModelTag(model.model)) {
    // Local models keep the protective default request window (KV-cache
    // budget). Cloud models omit num_ctx entirely: the server owns
    // allocation, and its true window is detected via getModelProperties().
    options.num_ctx = 36000;
  }
  return options;
}

// `think` is a top-level ChatRequest field in ollama-js (and the Ollama API),
// NOT a sampler option. It lives at the top level of OllamaLlmModelConfig.
function buildChatRequest<S extends true | false>(
  model: OllamaLlmModelConfig,
  messages: OllamaMessage[],
  tools: OllamaRequestTool[] | undefined,
  stream: S
): {
  model: string;
  options: Record<string, unknown>;
  messages: OllamaMessage[];
  tools: OllamaRequestTool[] | undefined;
  think?: boolean | 'high' | 'medium' | 'low';
  stream: S;
} {
  return {
    stream,
    model: model.model,
    options: buildRequestOptions(model),
    messages,
    tools,
    ...(model.think !== undefined ? { think: model.think } : {}),
  };
}

const MODEL_PROPERTIES_TTL_MS = 5 * 60 * 1000;

const modelPropertiesCache = new Map<
  string,
  { value: LlmModelProperties; fetchedAt: number }
>();
const modelPropertiesInFlight = new Map<string, Promise<LlmModelProperties>>();

function modelPropertiesCacheKey(model: OllamaLlmModelConfig): string {
  return `${model.host}|${model.model}`;
}

/** Detect per-model properties via client.show(). Vision capability comes
 *  from capabilities[]; contextWindow only for cloud models, where the server
 *  allocates the full reported window (for local models the GGUF maximum
 *  would overstate the usable KV-cache budget). Failures propagate to the
 *  caller — they are never cached, so the next request retries detection. */
async function fetchOllamaModelProperties(
  model: OllamaLlmModelConfig
): Promise<LlmModelProperties> {
  const key = modelPropertiesCacheKey(model);
  const cached = modelPropertiesCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < MODEL_PROPERTIES_TTL_MS) {
    return cached.value;
  }

  const inFlight = modelPropertiesInFlight.get(key);
  if (inFlight) {
    return inFlight;
  }

  const pending = (async () => {
    const client = createOllamaClient(model);
    const show = await client.show({ model: model.model });
    const capabilities = show.capabilities ?? [];

    const modelInfo =
      show.model_info instanceof Map
        ? show.model_info
        : new Map(Object.entries(show.model_info ?? {}));
    let contextLength: number | undefined;
    for (const [infoKey, infoValue] of modelInfo.entries()) {
      if (
        infoKey.endsWith('.context_length') &&
        typeof infoValue === 'number'
      ) {
        contextLength = infoValue;
      }
    }

    const value: LlmModelProperties = {
      supportsVision: capabilities.includes('vision'),
      ...(isCloudModelTag(model.model) && contextLength !== undefined
        ? { contextWindow: contextLength }
        : {}),
    };
    modelPropertiesCache.set(key, { value, fetchedAt: Date.now() });
    return value;
  })();

  modelPropertiesInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    modelPropertiesInFlight.delete(key);
  }
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
        // Transport-level truth: Ollama messages can carry images. Per-model
        // vision support is detected async via getModelProperties.
        supportsVision: true,
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
        const response = await client.chat(
          buildChatRequest(
            model,
            request.messages.map(toOllamaMessage),
            request.tools as OllamaRequestTool[] | undefined,
            false
          )
        );

        return {
          message: normalizeResponse(response.message),
        } satisfies LlmChatResponse;
      },
      chatStream: async (request, model) => {
        assertOllamaModel(model);
        const client = createOllamaClient(model);
        const response = (await client.chat(
          buildChatRequest(
            model,
            request.messages.map(toOllamaMessage),
            request.tools as OllamaRequestTool[] | undefined,
            true
          )
        )) as AbortableAsyncIterator<ChatResponse>;

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

      getModelProperties: async model => {
        assertOllamaModel(model);
        return fetchOllamaModelProperties(model);
      },
    };

    plugin.logger.log('registerPlugin: Registering Ollama provider.');
    broker.registerLlmProvider(providerRegistration);
    plugin.logger.log('registerPlugin: Ollama provider registered.');
  },
};

export default ollamaProviderPlugin;
