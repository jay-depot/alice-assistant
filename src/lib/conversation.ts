import OllamaClient, { ChatResponse, ToolCall } from 'ollama';
import type { AbortableAsyncIterator } from 'ollama';
import { randomUUID } from 'node:crypto';
import { UserConfig } from './user-config.js';
import {
  buildOllamaToolDescriptionObject,
  ToolCallEvents,
} from './tool-system.js';
import { getTools } from './tools.js';
import { DynamicPromptConversationType } from './dynamic-prompt.js';
import { retryAsPromised as retry } from 'retry-as-promised';
import {
  getConversationTypeDefinition,
  hasConversationType,
} from './conversation-types.js';
import { systemLogger } from './system-logger.js';
import type {
  Message,
  ConversationStreamingCallbacks,
  StartConversationOptions,
} from './conversation/types.js';

import { checkLLMResponseForDegeneracy } from './conversation/degeneracy-check.js';

import {
  assembleFullContext,
  type PromptAssemblerContext,
} from './conversation/prompt-assembler.js';

import {
  ConversationContextManager,
  type LlmConnectionDetails,
  type SummarizerFn,
} from './conversation/context-manager.js';

import { executeTools } from './conversation/tool-executor.js';

import { iterateStream } from './conversation/streaming-handler.js';

export {
  SUMMARY_HEADER,
  SUMMARY_PROMPT,
  checkLLMResponseForDegeneracy,
} from './conversation/degeneracy-check.js';
export type {
  Message,
  ConversationStreamingCallbacks,
  StartConversationOptions,
} from './conversation/types.js';

const TIMEOUT = undefined;
const MAX_TOOL_CALL_DEPTH = 10;
const MAX_LLM_RETRIES = 3;

function getLLMConnection() {
  return {
    host: UserConfig.getConfig().ollama.host,
    model: UserConfig.getConfig().ollama.model,
    options: {
      num_ctx: 36000,
      ...UserConfig.getConfig().ollama.options,
    },
  };
}

export class Conversation {
  static async sendDirectRequest(messages: Message[]): Promise<string> {
    const response = await retry(
      async () => {
        const res = await OllamaClient.chat({
          ...getLLMConnection(),
          messages: messages.map(message => ({
            role: message.role,
            content: message.content,
            tool_calls: message.tool_calls,
            tool_name: message.tool_name,
          })),
        });
        checkLLMResponseForDegeneracy(res.message.content || '');
        return res;
      },
      { max: MAX_LLM_RETRIES, timeout: TIMEOUT }
    );
    return response.message.content || '';
  }

  private llmConnection = {
    host: '',
    model: '',
    options: { num_ctx: 36000 },
  };

  public rawContext: Message[] = [];
  public compactedContext: Message[] = [];
  private lastTitleRequestTurn = -10;
  private contextManager: ConversationContextManager;

  public taintedToolNames: Set<string> = new Set();

  get isTainted(): boolean {
    return this.taintedToolNames.size > 0;
  }

  constructor(
    public type: DynamicPromptConversationType,
    public sessionId?: number,
    public taskAssistantId?: string,
    public agentInstanceId?: string
  ) {
    this.llmConnection = { ...getLLMConnection() };

    const summarizerFn: SummarizerFn = (messages: Message[]) =>
      Conversation.sendDirectRequest(messages);

    this.contextManager = new ConversationContextManager(
      this,
      this.llmConnection as LlmConnectionDetails,
      summarizerFn
    );
  }

  private appendToContext(message: Message): Promise<boolean> {
    return this.contextManager.appendToContext(message);
  }

  restoreContext(
    context: Message[],
    compactedContext?: Message[]
  ): Conversation {
    this.contextManager.restoreContext(context, compactedContext);
    return this;
  }

  getUnsynchronizedMessages(): Message[] {
    return this.contextManager.getUnsynchronizedMessages();
  }

  markUnsynchronizedMessagesSynchronized(): void {
    this.contextManager.markUnsynchronizedMessagesSynchronized();
  }

  async appendExternalMessage(message: Message): Promise<void> {
    await this.contextManager.appendToContext(message);
  }

  async compactContext(mode: 'normal' | 'full' | 'clear'): Promise<boolean> {
    return this.contextManager.compactContext(mode);
  }

  async closeConversation(): Promise<void> {
    await this.contextManager.closeConversation();
  }

  // ── LLM message dispatch ──────────────────────────────────────────

  async sendUserMessage(userMessage?: string): Promise<string> {
    const availableTools = getTools(this.type).map(t => t.name);

    if (userMessage) {
      await this.appendToContext({
        role: 'user',
        content: userMessage,
      });
    }

    const fullContext = await assembleFullContext(
      {
        conversationType: this.type,
        sessionId: this.sessionId,
        taskAssistantId: this.taskAssistantId,
        toolCallsAllowed: true,
        availableTools,
      },
      this.compactedContext
    );

    const response = await this.chatWithRetry(fullContext);

    systemLogger.log(
      'LLM response to user message:',
      response.message.content,
      '\nTool calls:',
      response.message.tool_calls?.map(tc => tc.function.name).join(', ')
    );

    const toolCalls = response.message.tool_calls;
    await this.appendToContext({
      role: 'assistant',
      content: response.message.content,
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (toolCalls && toolCalls.length > 0) {
      this.dispatchAssistantTurnStarted(response.message.content);
      return this.handleToolCalls(response);
    }

    return response.message.content || '';
  }

  async beginStreaming(
    callbacks: ConversationStreamingCallbacks,
    options?: { userMessage?: string; depth?: number }
  ): Promise<{ content: string; thinking: string; toolCalls: ToolCall[] }> {
    const depth = options?.depth ?? 0;
    const availableTools = getTools(this.type).map(t => t.name);
    const maxToolCallDepth =
      getConversationTypeDefinition(this.type)?.maxToolCallDepth ??
      MAX_TOOL_CALL_DEPTH;

    if (options?.userMessage) {
      await this.appendToContext({
        role: 'user',
        content: options.userMessage,
      });
    }

    const fullContext = await assembleFullContext(
      {
        conversationType: this.type,
        sessionId: this.sessionId,
        taskAssistantId: this.taskAssistantId,
        toolCallsAllowed: depth < maxToolCallDepth,
        availableTools,
      },
      this.compactedContext
    );

    let streamIterator: AbortableAsyncIterator<ChatResponse>;
    try {
      const streamResult = await OllamaClient.chat({
        ...this.llmConnection,
        messages: fullContext,
        tools: buildOllamaToolDescriptionObject(this.type, this.isTainted),
        stream: true,
      });
      streamIterator = streamResult as AbortableAsyncIterator<ChatResponse>;
    } catch (err) {
      callbacks.onError(err);
      throw err;
    }

    const { content, thinking, toolCalls } = await iterateStream(
      streamIterator,
      callbacks
    );

    checkLLMResponseForDegeneracy(content);

    await this.appendToContext({
      role: 'assistant',
      content,
      reasoning: thinking || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (toolCalls.length > 0) {
      this.dispatchAssistantTurnStarted(content);
    }

    return { content, thinking, toolCalls };
  }

  async executeToolCalls(toolCalls: ToolCall[], depth = 0): Promise<void> {
    const maxToolCallDepth =
      getConversationTypeDefinition(this.type)?.maxToolCallDepth ??
      MAX_TOOL_CALL_DEPTH;

    if (depth >= maxToolCallDepth) {
      await this.appendToContext({
        role: 'system',
        content:
          'The model attempted to make additional tool calls after the tool-call limit was reached. Answer the user in character using the information already available. Do not make any more tool calls for this conversation turn.',
      });
      return;
    }

    await this.runToolCallBatch(toolCalls);
  }

  // ── internal helpers ──────────────────────────────────────────────

  private async runToolCallBatch(toolCalls: ToolCall[]): Promise<void> {
    const callBatchId = randomUUID();
    const { toolResultMessages, taintedToolNamesAdded } = await executeTools({
      toolCalls,
      conversationType: this.type,
      isTainted: this.isTainted,
      taintedToolNames: this.taintedToolNames,
      sessionId: this.sessionId,
      taskAssistantId: this.taskAssistantId,
      agentInstanceId: this.agentInstanceId,
      callBatchId,
    });

    for (const toolName of taintedToolNamesAdded) {
      this.taintedToolNames.add(toolName);
    }

    for (const msg of toolResultMessages) {
      await this.appendToContext(msg);
    }
  }

  private async handleToolCalls(
    response: ChatResponse,
    depth = 0
  ): Promise<string> {
    const maxToolCallDepth =
      getConversationTypeDefinition(this.type)?.maxToolCallDepth ??
      MAX_TOOL_CALL_DEPTH;
    const callsStillAllowed = depth < maxToolCallDepth;
    const availableTools = getTools(this.type).map(t => t.name);
    const toolCalls = response.message.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      return response.message.content || '';
    }

    if (!callsStillAllowed) {
      return this.fallbackAfterToolCallLimit();
    }

    if (depth > MAX_TOOL_CALL_DEPTH) {
      throw new Error(
        'Maximum tool call depth exceeded. Possible infinite loop detected.'
      );
    }

    await this.runToolCallBatch(toolCalls);

    // Recurse with fresh prompt context
    const promptCtx: PromptAssemblerContext = {
      conversationType: this.type,
      sessionId: this.sessionId,
      taskAssistantId: this.taskAssistantId,
      toolCallsAllowed: callsStillAllowed,
      availableTools,
    };

    const nextFullContext = await assembleFullContext(
      promptCtx,
      this.compactedContext
    );

    const nextResponse = await this.chatWithRetry(nextFullContext);

    systemLogger.log(
      `LLM response after tool call at depth ${depth}:`,
      nextResponse.message.content,
      '\nTool calls:',
      nextResponse.message.tool_calls?.map(tc => tc.function.name).join(', ')
    );

    await this.appendToContext({
      role: 'assistant',
      content: nextResponse.message.content,
      tool_calls:
        nextResponse.message.tool_calls &&
        nextResponse.message.tool_calls.length > 0
          ? nextResponse.message.tool_calls
          : undefined,
    });

    if (
      nextResponse.message.tool_calls &&
      nextResponse.message.tool_calls.length > 0
    ) {
      this.dispatchAssistantTurnStarted(nextResponse.message.content);
    }

    return this.handleToolCalls(nextResponse, depth + 1);
  }

  private async fallbackAfterToolCallLimit(): Promise<string> {
    await this.appendToContext({
      role: 'system',
      content:
        'The model attempted to make additional tool calls after the tool-call limit was reached. Answer the user in character using the information already available. Do not make any more tool calls for this conversation turn.',
    });

    const availableTools = getTools(this.type).map(t => t.name);
    const promptCtx: PromptAssemblerContext = {
      conversationType: this.type,
      sessionId: this.sessionId,
      taskAssistantId: this.taskAssistantId,
      toolCallsAllowed: false,
      availableTools,
    };

    const fallbackFullContext = await assembleFullContext(
      promptCtx,
      this.compactedContext
    );

    const fallbackResponse = await retry(
      async () => {
        const res = await OllamaClient.chat({
          ...this.llmConnection,
          messages: fallbackFullContext,
        });
        checkLLMResponseForDegeneracy(res.message.content || '');
        return res;
      },
      { max: MAX_LLM_RETRIES, timeout: TIMEOUT }
    );

    await this.appendToContext({
      role: 'assistant',
      content: fallbackResponse.message.content,
      tool_calls:
        fallbackResponse.message.tool_calls &&
        fallbackResponse.message.tool_calls.length > 0
          ? fallbackResponse.message.tool_calls
          : undefined,
    });

    return fallbackResponse.message.content || '';
  }

  private async chatWithRetry(messages: Message[]): Promise<ChatResponse> {
    return retry(
      async () => {
        const res = await OllamaClient.chat({
          ...this.llmConnection,
          messages,
          tools: buildOllamaToolDescriptionObject(this.type, this.isTainted),
        });
        checkLLMResponseForDegeneracy(res.message.content || '');
        return res;
      },
      { max: MAX_LLM_RETRIES, timeout: TIMEOUT }
    );
  }

  private dispatchAssistantTurnStarted(content: string): void {
    void ToolCallEvents.dispatchToolCallEvent({
      type: 'assistant_turn_started',
      conversationType: this.type,
      sessionId: this.sessionId,
      taskAssistantId: this.taskAssistantId,
      agentInstanceId: this.agentInstanceId,
      assistantContent: content,
      timestamp: new Date().toISOString(),
    });
  }

  async maybeRequestTitle(): Promise<string | undefined> {
    const currentTurn = this.rawContext.length;
    if (currentTurn - this.lastTitleRequestTurn < 10) {
      return undefined;
    }

    this.lastTitleRequestTurn = currentTurn;

    const titlePrompt =
      `Based on the conversation so far, provide a concise title for this ` +
      `conversation that captures the main topics discussed. Do not include ` +
      `any headers or formatting, reply with only the title text of 6 words or less.`;

    const response = await retry(
      async () => {
        const res = await OllamaClient.chat({
          ...this.llmConnection,
          messages: [
            ...this.compactedContext.map(message => ({
              role: message.role,
              content: message.content,
              tool_calls: message.tool_calls,
            })),
            { role: 'system', content: titlePrompt },
          ],
          tools: buildOllamaToolDescriptionObject(this.type, this.isTainted),
        });

        checkLLMResponseForDegeneracy(res.message.content || '');
        return res;
      },
      { max: MAX_LLM_RETRIES, timeout: TIMEOUT }
    );

    return (
      response.message.content
        .replaceAll(/(\n|\r)/g, ' ')
        .replaceAll(/(\*|#|")/g, '') || ''
    );
  }
}

export function startConversation(
  type: DynamicPromptConversationType,
  options?: StartConversationOptions
): Conversation {
  if (!hasConversationType(type)) {
    throw new Error(
      `Cannot start conversation with unknown conversation type ${type}. Register it before using it.`
    );
  }

  return new Conversation(
    type,
    options?.sessionId,
    options?.taskAssistantId,
    options?.agentInstanceId
  );
}
