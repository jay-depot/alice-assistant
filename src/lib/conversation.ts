import { randomUUID } from 'node:crypto';
import { UserConfig } from './user-config.js';
import {
  getActiveLlmProvider,
  getApproximateContextWindow,
  resolveLlmProviderForRequest,
  type ActiveLlmProvider,
  type LlmChatResponse,
  type LlmRoutingContext,
  type LlmToolCall,
} from './llm-provider.js';
import { buildLlmToolDefinitions, ToolCallEvents } from './tool-system.js';
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

export class Conversation {
  static async sendDirectRequest(messages: Message[]): Promise<string> {
    const activeProvider = getActiveLlmProvider(UserConfig.getConfig());
    const response = await retry(
      async () => {
        const res = await activeProvider.provider.chat(
          { messages },
          activeProvider.model
        );
        checkLLMResponseForDegeneracy(res.message.content || '');
        return res;
      },
      { max: MAX_LLM_RETRIES, timeout: TIMEOUT }
    );
    return response.message.content || '';
  }

  private activeProvider: ActiveLlmProvider;

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
    this.activeProvider = getActiveLlmProvider(UserConfig.getConfig());

    const summarizerFn: SummarizerFn = (messages: Message[]) =>
      Conversation.sendDirectRequest(messages);

    this.contextManager = new ConversationContextManager(
      this,
      getApproximateContextWindow(this.activeProvider.model),
      summarizerFn
    );
  }

  private resolveProvider(context: LlmRoutingContext = {}): ActiveLlmProvider {
    return resolveLlmProviderForRequest(UserConfig.getConfig(), context);
  }

  private buildRequestTools(
    activeProvider: ActiveLlmProvider,
    toolCallsAllowed = true
  ): unknown[] | undefined {
    if (
      !toolCallsAllowed ||
      !activeProvider.provider.capabilities.supportsTools
    ) {
      return undefined;
    }

    const toolDefinitions = buildLlmToolDefinitions(this.type, this.isTainted);
    if (toolDefinitions.length === 0) {
      return undefined;
    }

    return activeProvider.provider.buildToolDefinitions
      ? activeProvider.provider.buildToolDefinitions(toolDefinitions)
      : toolDefinitions;
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

  async sendUserMessage(
    userMessage?: string,
    options?: { hasVisionInput?: boolean }
  ): Promise<string> {
    const availableTools = getTools(this.type).map(t => t.canonicalName ?? t.name);

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

    const activeProvider = this.resolveProvider({
      latestUserMessage: userMessage,
      conversationType: this.type,
      hasVisionInput: options?.hasVisionInput,
    });
    this.activeProvider = activeProvider;

    const response = await this.chatWithRetry(
      fullContext,
      true,
      activeProvider
    );

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
    options?: { userMessage?: string; depth?: number; hasVisionInput?: boolean }
  ): Promise<{ content: string; thinking: string; toolCalls: LlmToolCall[] }> {
    const depth = options?.depth ?? 0;
    const availableTools = getTools(this.type).map(t => t.canonicalName ?? t.name);
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

    const activeProvider = this.resolveProvider({
      latestUserMessage: options?.userMessage,
      conversationType: this.type,
      hasVisionInput: options?.hasVisionInput,
    });
    this.activeProvider = activeProvider;

    if (!activeProvider.provider.chatStream) {
      const err = new Error(
        `The active LLM provider (${activeProvider.model.provider}) does not support streaming.`
      );
      callbacks.onError(err);
      throw err;
    }

    let streamIterator: AsyncIterable<
      import('./llm-provider.js').LlmStreamChunk
    >;
    try {
      streamIterator = await activeProvider.provider.chatStream(
        {
          messages: fullContext,
          tools: this.buildRequestTools(
            activeProvider,
            depth < maxToolCallDepth
          ),
        },
        activeProvider.model
      );
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

  async executeToolCalls(
    toolCalls: LlmToolCall[],
    depth = 0,
    callBatchId?: string
  ): Promise<void> {
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

    await this.runToolCallBatch(toolCalls, callBatchId);
  }

  // ── internal helpers ──────────────────────────────────────────────

  private async runToolCallBatch(
    toolCalls: LlmToolCall[],
    callBatchId?: string
  ): Promise<void> {
    const batchId = callBatchId ?? randomUUID();
    const { toolResultMessages, taintedToolNamesAdded } = await executeTools({
      toolCalls,
      conversationType: this.type,
      isTainted: this.isTainted,
      taintedToolNames: this.taintedToolNames,
      sessionId: this.sessionId,
      taskAssistantId: this.taskAssistantId,
      agentInstanceId: this.agentInstanceId,
      callBatchId: batchId,
    });

    for (const toolName of taintedToolNamesAdded) {
      this.taintedToolNames.add(toolName);
    }

    for (const msg of toolResultMessages) {
      await this.appendToContext(msg);
    }
  }

  private async handleToolCalls(
    response: LlmChatResponse,
    depth = 0
  ): Promise<string> {
    const maxToolCallDepth =
      getConversationTypeDefinition(this.type)?.maxToolCallDepth ??
      MAX_TOOL_CALL_DEPTH;
    const callsStillAllowed = depth < maxToolCallDepth;
    const availableTools = getTools(this.type).map(t => t.canonicalName ?? t.name);
    const toolCalls = response.message.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      return response.message.content || '';
    }

    if (!callsStillAllowed) {
      return this.fallbackAfterToolCallLimit();
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

    const availableTools = getTools(this.type).map(t => t.canonicalName ?? t.name);
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

    const fallbackResponse = await this.chatWithRetry(
      fallbackFullContext,
      false
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

  private async chatWithRetry(
    messages: Message[],
    toolCallsAllowed = true,
    activeProvider = this.activeProvider
  ): Promise<LlmChatResponse> {
    return retry(
      async () => {
        const res = await activeProvider.provider.chat(
          {
            messages,
            tools: this.buildRequestTools(activeProvider, toolCallsAllowed),
          },
          activeProvider.model
        );
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
        const activeProvider = this.resolveProvider({
          conversationType: this.type,
        });

        const res = await activeProvider.provider.chat(
          {
            messages: [
              ...this.compactedContext,
              { role: 'system', content: titlePrompt },
            ],
          },
          activeProvider.model
        );

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
