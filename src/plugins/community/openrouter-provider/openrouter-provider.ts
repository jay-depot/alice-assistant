import { AlicePlugin } from '../../../lib.js';
import type {
  LlmChatResponse,
  LlmMessage,
  LlmProviderRegistration,
  LlmStreamChunk,
  LlmToolCall,
  OpenRouterLlmModelConfig,
} from '../../../lib/llm-provider.js';

type OpenRouterContentPart = {
  type?: string;
  text?: string;
  image_url?: {
    url: string;
  };
};

type OpenRouterToolCallPayload = {
  id?: string;
  index?: number;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type OpenRouterAssistantMessage = {
  role?: string;
  content?: string | OpenRouterContentPart[] | null;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: OpenRouterToolCallPayload[];
};

type OpenRouterChoice = {
  message?: OpenRouterAssistantMessage;
  delta?: OpenRouterAssistantMessage;
  finish_reason?: string | null;
};

type OpenRouterResponsePayload = {
  choices?: OpenRouterChoice[];
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
};

type OpenRouterRequestMessage = {
  role: string;
  content: string | OpenRouterContentPart[] | null;
  tool_calls?: Array<{
    id?: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
};

function toOpenRouterContent(
  message: LlmMessage
): string | OpenRouterContentPart[] | null {
  if (!message.images || message.images.length === 0) {
    return message.content;
  }

  const parts: OpenRouterContentPart[] = [];
  if (message.content?.trim()) {
    parts.push({ type: 'text', text: message.content });
  }

  for (const image of message.images) {
    parts.push({
      type: 'image_url',
      image_url: {
        url: image.dataUrl,
      },
    });
  }

  return parts;
}

type PendingToolCall = {
  id?: string;
  name: string;
  argumentsText: string;
};

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function assertOpenRouterModel(
  model: OpenRouterLlmModelConfig | { provider: string }
): asserts model is OpenRouterLlmModelConfig {
  if (model.provider !== 'openrouter') {
    throw new Error(
      `OpenRouter provider received mismatched model config for provider "${model.provider}".`
    );
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractTextContent(
  content: string | OpenRouterContentPart[] | null | undefined
): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map(part => (part.type === 'text' || !part.type ? part.text || '' : ''))
    .join('');
}

function parseToolArguments(
  rawArguments: string,
  context: string
): Record<string, unknown> {
  if (!rawArguments.trim()) {
    return {};
  }

  const parsed = safeJsonParse(rawArguments);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  throw new Error(
    `OpenRouter Provider: Failed to parse tool arguments for ${context}. Received: ${rawArguments}`
  );
}

function normalizeToolCalls(
  toolCalls?: OpenRouterToolCallPayload[]
): LlmToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls.map((toolCall, index) => ({
    id: toolCall.id,
    function: {
      name: toolCall.function?.name || `tool-${index}`,
      arguments: parseToolArguments(
        toolCall.function?.arguments || '{}',
        toolCall.function?.name || `tool-${index}`
      ),
    },
  }));
}

function normalizeMessage(message: OpenRouterAssistantMessage): LlmMessage {
  return {
    role: message.role || 'assistant',
    content: extractTextContent(message.content),
    reasoning: message.reasoning || message.reasoning_content,
    tool_calls: normalizeToolCalls(message.tool_calls),
  };
}

function toOpenRouterMessage(message: LlmMessage): OpenRouterRequestMessage {
  return {
    role: message.role,
    content:
      message.role === 'assistant' && message.tool_calls?.length
        ? message.content || null
        : message.role === 'tool'
          ? message.content
          : toOpenRouterContent(message),
    tool_call_id: message.tool_call_id,
    tool_calls: message.tool_calls?.map(toolCall => ({
      id: toolCall.id,
      type: 'function' as const,
      function: {
        name: toolCall.function.name,
        arguments: JSON.stringify(toolCall.function.arguments),
      },
    })),
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  const payload = safeJsonParse(await response.text()) as
    | OpenRouterResponsePayload
    | string;
  const retryAfter = response.headers.get('retry-after');

  const normalizedPayload =
    typeof payload === 'string'
      ? payload
      : payload.error?.message ||
        payload.error?.code ||
        payload.error?.type ||
        `HTTP ${response.status}`;

  return [
    `OpenRouter Provider: Request failed with HTTP ${response.status}.`,
    normalizedPayload,
    retryAfter ? `Retry after ${retryAfter} second(s).` : undefined,
  ]
    .filter(Boolean)
    .join(' ');
}

function buildHeaders(model: OpenRouterLlmModelConfig): HeadersInit {
  const apiKey = model.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OpenRouter Provider: No API key configured. Set llm.models[useFor=fallback].apiKey or OPENROUTER_API_KEY.'
    );
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (model.siteUrl) {
    headers['HTTP-Referer'] = model.siteUrl;
  }

  if (model.siteName) {
    headers['X-Title'] = model.siteName;
  }

  return headers;
}

function buildRequestBody(
  request: { messages: LlmMessage[]; tools?: unknown[] },
  model: OpenRouterLlmModelConfig,
  stream: boolean
): Record<string, unknown> {
  return {
    model: model.model,
    messages: request.messages.map(toOpenRouterMessage),
    tools: request.tools,
    stream,
    temperature: model.temperature,
    top_p: model.topP,
    max_tokens: model.maxTokens,
  };
}

async function postOpenRouter(
  request: { messages: LlmMessage[]; tools?: unknown[] },
  model: OpenRouterLlmModelConfig,
  stream: boolean
): Promise<Response> {
  const response = await fetch(
    `${model.baseUrl || OPENROUTER_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: buildHeaders(model),
      body: JSON.stringify(buildRequestBody(request, model, stream)),
    }
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response;
}

function snapshotToolCalls(
  pendingToolCalls: Map<number, PendingToolCall>
): LlmToolCall[] {
  return [...pendingToolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, toolCall], index) => {
      try {
        return [
          {
            id: toolCall.id,
            function: {
              name: toolCall.name || `tool-${index}`,
              arguments: parseToolArguments(
                toolCall.argumentsText || '{}',
                toolCall.name || `tool-${index}`
              ),
            },
          },
        ];
      } catch {
        return [];
      }
    });
}

async function readCompletionPayload(
  response: Response
): Promise<OpenRouterResponsePayload> {
  const payload = safeJsonParse(await response.text());
  if (!payload || typeof payload !== 'object') {
    throw new Error(
      'OpenRouter Provider: The API returned an invalid response body.'
    );
  }

  return payload as OpenRouterResponsePayload;
}

async function* streamOpenRouter(
  response: Response
): AsyncIterable<LlmStreamChunk> {
  if (!response.body) {
    throw new Error('OpenRouter Provider: Streaming response body was empty.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pendingToolCalls = new Map<number, PendingToolCall>();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes('\n\n')) {
      const boundaryIndex = buffer.indexOf('\n\n');
      const eventText = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);

      const data = eventText
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');

      if (!data) {
        continue;
      }

      if (data === '[DONE]') {
        const finalToolCalls = snapshotToolCalls(pendingToolCalls);
        if (finalToolCalls.length > 0) {
          yield {
            message: {
              tool_calls: finalToolCalls,
            },
          };
        }
        yield { done: true };
        return;
      }

      const payload = safeJsonParse(data);
      if (!payload || typeof payload !== 'object') {
        continue;
      }

      const choice = (payload as OpenRouterResponsePayload).choices?.[0];
      const delta = choice?.delta;
      if (!delta) {
        continue;
      }

      const toolFragments = delta.tool_calls || [];
      for (const fragment of toolFragments) {
        const index = fragment.index ?? 0;
        const current = pendingToolCalls.get(index) || {
          id: fragment.id,
          name: '',
          argumentsText: '',
        };

        current.id = fragment.id || current.id;
        current.name += fragment.function?.name || '';
        current.argumentsText += fragment.function?.arguments || '';
        pendingToolCalls.set(index, current);
      }

      const normalizedToolCalls = snapshotToolCalls(pendingToolCalls);
      yield {
        message: {
          content: extractTextContent(delta.content),
          reasoning: delta.reasoning || delta.reasoning_content,
          tool_calls:
            normalizedToolCalls.length > 0 ? normalizedToolCalls : undefined,
        },
        done:
          choice?.finish_reason !== null && choice?.finish_reason !== undefined,
      };

      if (choice?.finish_reason) {
        return;
      }
    }
  }

  yield { done: true };
}

const openRouterProviderPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'openrouter-provider',
    name: 'OpenRouter Provider',
    brandColor: '#ff5f77',
    description:
      'Registers OpenRouter as an optional cloud LLM provider with chat, streaming, and tool-call support.',
    version: 'LATEST',
    dependencies: [{ id: 'llm-provider-broker', version: 'LATEST' }],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const broker = plugin.request('llm-provider-broker');
    if (!broker) {
      throw new Error(
        'OpenRouter Provider: LLM provider broker API is unavailable. Enable llm-provider-broker first.'
      );
    }

    const providerRegistration: LlmProviderRegistration = {
      id: 'openrouter',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
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
        assertOpenRouterModel(model);
        const response = await postOpenRouter(request, model, false);
        const payload = await readCompletionPayload(response);
        const message = payload.choices?.[0]?.message;
        if (!message) {
          throw new Error(
            'OpenRouter Provider: The API returned no message choices. Check the selected model and provider settings.'
          );
        }

        return {
          message: normalizeMessage(message),
        } satisfies LlmChatResponse;
      },
      chatStream: async (request, model) => {
        assertOpenRouterModel(model);
        const response = await postOpenRouter(request, model, true);
        return streamOpenRouter(response);
      },
    };

    plugin.logger.log('registerPlugin: Registering OpenRouter provider.');
    broker.registerLlmProvider(providerRegistration);
    plugin.logger.log('registerPlugin: OpenRouter provider registered.');
  },
};

export default openRouterProviderPlugin;
