import OllamaClient, { ChatResponse, ToolCall } from 'ollama';
import { randomUUID } from 'node:crypto';
import { UserConfig } from './user-config.js';
import {
  buildOllamaToolDescriptionObject,
  ToolCallEvents,
} from './tool-system.js';
import { getTools } from './tools.js';
import { DynamicPromptConversationType } from './dynamic-prompt.js';
import { getHeaderPrompts } from './header-prompts.js';
import { getFooterPrompts } from './footer-prompts.js';
import { PluginHookInvocations } from './plugin-hooks.js';
import { retryAsPromised as retry } from 'retry-as-promised';
import {
  getConversationTypeDefinition,
  hasConversationType,
} from './conversation-types.js';
import { systemLogger } from './system-logger.js';

export const SUMMARY_HEADER = '# Summary of earlier conversation:\n';
const SUMMARY_PROMPT =
  `Summarize the following conversation between the user and the ` +
  `assistant in a way that preserves all relevant information and details, but is as ` +
  `concise as possible. The summary should be in bullet point format, with each bullet ` +
  `point representing a single turn in the conversation. Be sure to include all ` +
  `relevant details and information from the conversation, but remove any fluff ` +
  `or filler content. Be especially certain to include any proper names, tasks with ` +
  `their statuses, and code samples, if applicable, in your summary. The summary will ` +
  `be used to provide context for future conversation turns, so it should be as ` +
  `informative as possible while still being concise.` +
  `\n\nConversation:\n\n`;
const TIMEOUT = undefined;

const MAX_TOOL_CALL_DEPTH = 10;
export type Message = {
  role: string;
  content: string;
  tool_calls?: ToolCall[];
};

export type StartConversationOptions = {
  sessionId?: number;
  /** Set this when the conversation is for a task assistant. */
  taskAssistantId?: string;
  /** Set when the conversation belongs to a session-linked agent. */
  agentInstanceId?: string;
};

export function checkLLMResponseForDegeneracy(response: string) {
  // We want to fail on the following, and force a retry:
  // - Long chains of the same repeating pattern.
  // - Broken tool calls.
  if (/(\b\w+\b)(?:\s+\1\b){20,}/.test(response)) {
    systemLogger.warn(
      'LLM response appears to be degenerate (repeating pattern detected). Response:',
      response
    );
    throw new Error(
      'LLM response appears to be degenerate (repeating the same pattern over and over).'
    );
  }
  if (
    response.includes('"function_calls":') &&
    !response.includes('"function_calls": []') &&
    !response.includes('"function_calls":[')
  ) {
    systemLogger.warn(
      'LLM response appears to be degenerate (broken tool call formatting). Response:',
      response
    );
    throw new Error(
      'LLM response appears to be degenerate (broken tool call formatting).'
    );
  }
  // Ollama tool calls specifically like to fail by dumping the tool name, a couple random unicode
  // characters, and then the tool arguments all as one big blob of text in the content field,
  // without properly populating the tool_calls field.
  // The pattern is something like this: TOOLNAME [GARBAGE_CHARACTERS] {JSON-STRINGIFIED-ARGUMENTS}
  // eslint-disable-next-line no-control-regex
  if (/([A-Za-z0-9_]+)\s*[\u0000-\u001F\u007F-\uFFFF]+({.*})/.test(response)) {
    systemLogger.warn(
      'LLM response appears to be degenerate (tool call appears to be dumped in content field with garbage characters). Response:',
      response
    );
    throw new Error(
      'LLM response appears to be degenerate (tool call appears to be dumped in content field with garbage characters).'
    );
  }
}

function getLLMConnection() {
  return {
    host: UserConfig.getConfig().ollama.host,
    model: UserConfig.getConfig().ollama.model,
    options: {
      num_ctx: 36000, // Ollama defaults to ~4k on most consumer GPUs, but Qwen models can go a LOT higher without using much vram. At home I set it to 128k and it only uses about 10gb of vram.
      ...UserConfig.getConfig().ollama.options, // allow the user to override settings like context window size, thinking time, temperature, etc. in the config, while being able to provide "sensible" defaults.
    },
  };
}
export class Conversation {
  /**
   * Send any context to the LLM. No headers or footers from the usual "ALICE" system are added.
   *
   * Use this for one-off requests, like summarizing text, but also can be used by plugins that
   * might want to create their own conversation-like object to manage an LLM context for a
   * different purpose.
   */
  static async sendDirectRequest(messages: Message[]): Promise<string> {
    const response = await retry(
      async () => {
        const res = await OllamaClient.chat({
          ...getLLMConnection(),
          messages: messages.map(message => ({
            role: message.role,
            content: message.content,
            tool_calls: message.tool_calls,
          })),
        });
        checkLLMResponseForDegeneracy(res.message.content || '');
        return res;
      },
      {
        max: 3,
        timeout: TIMEOUT,
      }
    );
    return response.message.content || '';
  }

  private llmConnection = {
    host: '',
    model: '',
    options: {
      num_ctx: 36000, // Ollama defaults to ~4k on most consumer GPUs, but Qwen models can go a LOT higher without using much vram. At home I set it to 128k and it only uses about 10gb of vram.
    },
  };

  public rawContext: Message[] = [];
  public compactedContext: Message[] = [];
  private synchronizedRawMessageCount = 0;

  /**
   * Tracks which tainted tools have been called in this conversation.
   * Once a tainted tool runs, the conversation is considered tainted for its
   * entire lifetime — secure tools will be blocked from that point on.
   */
  public taintedToolNames: Set<string> = new Set();

  /** True once any tainted tool has been called in this conversation. */
  get isTainted(): boolean {
    return this.taintedToolNames.size > 0;
  }

  constructor(
    public type: DynamicPromptConversationType,
    public sessionId?: number,
    public taskAssistantId?: string,
    public agentInstanceId?: string
  ) {
    this.llmConnection = {
      ...getLLMConnection(),
    };
  }

  /**
   * Quickly restore an LLM transaction with externally stored context. Returns the same
   * transaction object for easy chaining. Use this for the web interface, not for the
   * voice interface, which should maintain transaction state itself.
   *
   * @param context The conversation context to restore for this transaction. This should be an array of messages, where each message has a "role" (either "user" or "assistant") and "content" (the text content of the message).
   * @returns the same llmTransaction object for easy chained calling
   */
  restoreContext(
    context: Message[],
    compactedContext?: Message[]
  ): Conversation {
    // Let's disarm a common foot-gun right off the bat.
    if (this.rawContext.length > 0) {
      throw new Error(
        'Context has already been set for this transaction. Cannot restore context more than once.'
      );
    }

    this.compactedContext = [...(compactedContext || context)];
    this.rawContext = [...context];
    this.synchronizedRawMessageCount = this.rawContext.length;

    return this;
  }

  getUnsynchronizedMessages(): Message[] {
    return this.rawContext.slice(this.synchronizedRawMessageCount);
  }

  markUnsynchronizedMessagesSynchronized(): void {
    this.synchronizedRawMessageCount = this.rawContext.length;
  }

  async appendExternalMessage(message: Message): Promise<void> {
    await this.appendToContext(message);
  }

  /**
   * Manually compact the conversation context.
   *
   * - `'normal'`: Summarize the oldest half of non-summary messages if context
   *   exceeds 50% of the context window. Same as the automatic compaction that
   *   runs after each message. Returns true if compaction occurred.
   *
   * - `'full'`: Summarize ALL non-summary messages into a single summary.
   *   Useful before sleeping to minimize serialized state size.
   *   Returns true if there were non-summary messages to summarize.
   *
   * - `'clear'`: Full compact, then evict all summary messages by firing
   *   `onContextCompactionSummariesWillBeDeleted` so the memory plugin can
   *   persist them. After clear, the compacted context contains only the
   *   latest summary (if any non-summary messages existed). This is a
   *   "fresh start" that preserves history in the memory plugin.
   */
  async compactContext(mode: 'normal' | 'full' | 'clear'): Promise<boolean> {
    if (mode === 'normal') {
      return this.maybeCompactContext();
    }

    if (mode === 'full' || mode === 'clear') {
      const firstNonSummaryMessageIndex = this.compactedContext.findIndex(
        m => !m.content.startsWith(SUMMARY_HEADER)
      );

      if (firstNonSummaryMessageIndex === -1) {
        // Everything is already summaries
        if (mode === 'clear' && this.compactedContext.length > 0) {
          await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(
            this.compactedContext
          );
          this.compactedContext = [];
        }
        return false;
      }

      const messagesToSummarize = this.compactedContext.slice(
        firstNonSummaryMessageIndex
      );

      if (messagesToSummarize.length === 0) {
        if (mode === 'clear' && firstNonSummaryMessageIndex > 0) {
          await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(
            this.compactedContext
          );
          this.compactedContext = [];
        }
        return false;
      }

      const summary = await Conversation.sendDirectRequest([
        {
          role: 'system',
          content:
            SUMMARY_PROMPT +
            messagesToSummarize
              .map(m => `${m.role.toUpperCase()}: ${m.content}`)
              .join('\n\n'),
        },
      ]);

      systemLogger.debug(`Conversation summary generated:\n${summary}`);

      const newSummary: Message = {
        role: 'system',
        content: `${SUMMARY_HEADER} \n${new Date().toLocaleString()}\n\n${summary}`,
      };

      if (mode === 'full') {
        this.compactedContext = [
          ...this.compactedContext.slice(0, firstNonSummaryMessageIndex),
          newSummary,
        ];
      } else {
        // mode === 'clear'
        // Evict all existing summaries + the new one to memory plugin
        const allSummaries = [
          ...this.compactedContext.slice(0, firstNonSummaryMessageIndex),
          newSummary,
        ];
        await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(
          allSummaries
        );
        this.compactedContext = [];
      }

      return true;
    }

    return false;
  }

  private async appendToContext(message: Message) {
    this.rawContext.push(message);
    this.compactedContext.push(message);

    await this.maybeCompactContext();
  }

  /**
   * Checks the current length of the (compacted) conversation context, and if it exceeds
   * a certain threshold, summarizes the oldest parts of the conversation and replaces them
   * with the summary. Returns true if the context needed to be and was compacted, false
   * otherwise.
   */
  private async maybeCompactContext(): Promise<boolean> {
    // We're going super lazy here and just counting the words. Some words are really two
    // tokens, but also some are zero tokens, so it should be close enough for this purpose.
    const approximateContextLength = this.compactedContext.reduce(
      (acc, message) => acc + message.content.split(' ').length,
      0
    );
    // Start compacting once we hit 50% of the context window, so we have room for our
    // system prompts and the future conversation.
    const contextLengthThreshold =
      (this.llmConnection.options.num_ctx ?? 16000) * 0.5;

    if (approximateContextLength > contextLengthThreshold) {
      const firstNonSummaryMessageIndex = this.compactedContext.findIndex(
        m => !m.content.startsWith(SUMMARY_HEADER)
      );
      const messageCount = this.compactedContext.slice(
        firstNonSummaryMessageIndex
      ).length;
      // We'll do half the messages.

      const messagesToSummarize = this.compactedContext.slice(
        firstNonSummaryMessageIndex,
        firstNonSummaryMessageIndex + Math.floor(messageCount / 2)
      );

      const summaryPrompt =
        SUMMARY_PROMPT +
        messagesToSummarize
          .map(m => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n\n');

      const summaryResponse = await retry(
        async () => {
          const res = await OllamaClient.chat({
            ...this.llmConnection,
            messages: [{ role: 'system', content: summaryPrompt }],
          });
          checkLLMResponseForDegeneracy(res.message.content || '');
          return res;
        },
        {
          max: 3,
          timeout: TIMEOUT,
        }
      );

      const summary = summaryResponse.message.content || '';
      this.compactedContext = [
        // Keep any existing summary messages.
        ...this.compactedContext.slice(0, firstNonSummaryMessageIndex),
        {
          role: 'system',
          content: `${SUMMARY_HEADER} \n${new Date().toLocaleString()}\n\n${summary}`,
        },
        ...this.compactedContext.slice(
          firstNonSummaryMessageIndex + messagesToSummarize.length
        ),
      ];

      systemLogger.debug(`Conversation summary generated:\n${summary}`);

      // And now, we check if the compacted context is *still* too long. If it is, we're
      // going to fire off a hook invocation `onContextCompactionSummariesWillBeDeleted`
      // with the oldest half the summaries, so plugins (only memory, by default) can capture
      // and store them.

      const newApproximateContextLength = this.compactedContext.reduce(
        (acc, message) => acc + message.content.split(' ').length,
        0
      );

      if (newApproximateContextLength > contextLengthThreshold) {
        const summariesToDelete = this.compactedContext
          .filter(m => m.content.startsWith(SUMMARY_HEADER))
          .slice(0, Math.floor(messageCount / 4));
        // Fire off the hook invocation with the oldest half the summaries.
        await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(
          summariesToDelete
        );
      }

      return true;
    }

    return false;
  }

  async sendUserMessage(userMessage?: string): Promise<string> {
    const availableTools = getTools(this.type).map(t => t.name);
    const headerPrompts = await getHeaderPrompts({
      conversationType: this.type,
      sessionId: this.sessionId,
      taskAssistantId: this.taskAssistantId,
      toolCallsAllowed: true,
      availableTools,
    });
    const footerPrompts = await getFooterPrompts({
      conversationType: this.type,
      sessionId: this.sessionId,
      taskAssistantId: this.taskAssistantId,
      availableTools,
    });

    if (userMessage) {
      await this.appendToContext({
        role: 'user',
        content: userMessage,
      });
    }

    const fullContext = [
      ...headerPrompts.map(prompt => ({ role: 'system', content: prompt })),
      ...this.compactedContext,
      ...footerPrompts.map(prompt => ({ role: 'system', content: prompt })),
    ];

    const response = await retry(
      async () => {
        const res = await OllamaClient.chat({
          ...this.llmConnection,
          messages: fullContext,
          tools: buildOllamaToolDescriptionObject(this.type, this.isTainted),
        });
        checkLLMResponseForDegeneracy(res.message.content || '');
        return res;
      },
      {
        max: 3,
        timeout: TIMEOUT,
      }
    );

    systemLogger.log(
      'LLM response to user message:',
      response.message.content,
      '\nTool calls:',
      response.message.tool_calls
        ?.map(toolCall => `${toolCall.function.name}`)
        .join(', ')
    );

    const toolCalls = response.message.tool_calls;
    await this.appendToContext({
      role: 'assistant',
      content: response.message.content,
      tool_calls: toolCalls,
    });

    if (toolCalls && toolCalls.length > 0) {
      void ToolCallEvents.dispatchToolCallEvent({
        type: 'assistant_turn_started',
        conversationType: this.type,
        sessionId: this.sessionId,
        taskAssistantId: this.taskAssistantId,
        agentInstanceId: this.agentInstanceId,
        assistantContent: response.message.content,
        timestamp: new Date().toISOString(),
      });
      return this.handleToolCalls(response);
    }

    return response.message.content || '';
  }

  private async handleToolCalls(
    response: ChatResponse,
    depth = 0
  ): Promise<string> {
    // Check if the response content is a tool call. If it is, execute the tool call and send the
    // appropriate "tool response" prompt back to the LLM, then wait for the next response. If it's
    // not a tool call, just return the response content.
    const maxToolCallDepth =
      getConversationTypeDefinition(this.type)?.maxToolCallDepth ??
      MAX_TOOL_CALL_DEPTH;
    const callsStillAllowed = depth < maxToolCallDepth;
    const availableTools = getTools(this.type).map(t => t.name);
    const footerPrompts = await getFooterPrompts({
      conversationType: this.type,
      sessionId: this.sessionId,
      taskAssistantId: this.taskAssistantId,
      availableTools,
    });
    const promptIfCallsAvailable = ` - If you need to make another tool call, make it now. Otherwise, answer the user's query in character. You have ${maxToolCallDepth - depth} remaining recursive tool calls you may make regarding this user query.`;
    const promptIfNoCallsAvailable =
      ` - You may make no more recursive tool calls for this conversation turn, so you must answer the user's query in character.\n` +
      ` - If you still do not have sufficient information to form a complete answer, you have two options: \n` +
      `   1) Do your best with the information you have, or \n` +
      `   2) If you are missing a specific piece of information that would be critical to forming a complete answer, ask the user in character ` +
      `if you can continue looking. If they agree, the next round of conversation will have a fresh tool-call budget.`;

    const continuationPrompt = callsStillAllowed
      ? promptIfCallsAvailable
      : promptIfNoCallsAvailable;
    const toolCalls = response.message.tool_calls;

    // Generate a callBatchId for this depth iteration — all tool calls in the same
    // Promise.all batch share the same callBatchId.
    const callBatchId = randomUUID();

    const headerPrompts = await getHeaderPrompts({
      conversationType: this.type,
      sessionId: this.sessionId,
      taskAssistantId: this.taskAssistantId,
      toolCallsAllowed: callsStillAllowed,
      availableTools,
    });
    if (toolCalls && toolCalls.length > 0) {
      if (!callsStillAllowed) {
        await this.appendToContext({
          role: 'system',
          content:
            'The model attempted to make additional tool calls after the tool-call limit was reached. Answer the user in character using the information already available. Do not make any more tool calls for this conversation turn.',
        });

        const fallbackResponse = await retry(
          async () => {
            const res = await OllamaClient.chat({
              ...this.llmConnection,
              messages: [
                ...headerPrompts.map(prompt => ({
                  role: 'system',
                  content: prompt,
                })),
                ...this.compactedContext,
                ...footerPrompts.map(prompt => ({
                  role: 'system',
                  content: prompt,
                })),
              ],
            });

            checkLLMResponseForDegeneracy(res.message.content || '');
            return res;
          },
          {
            max: 3,
            timeout: TIMEOUT,
          }
        );

        await this.appendToContext({
          role: 'assistant',
          content: fallbackResponse.message.content,
          tool_calls: fallbackResponse.message.tool_calls,
        });

        return fallbackResponse.message.content || '';
      }

      if (depth > maxToolCallDepth) {
        throw new Error(
          'Maximum tool call depth exceeded. Possible infinite loop detected.'
        );
      }

      const resultParts = await Promise.all(
        toolCalls.map(async toolCall => {
          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments;
          systemLogger.log(JSON.stringify({ toolName, toolArgs }));
          // Double check the tool is actually enabled in the config, and that it actually exists.
          const tools = getTools(this.type);
          const tool = tools.find(t => t.name === toolName);
          if (!tool) {
            return `Tool ${toolName} is not recognized.`;
          }

          // Enforce taint security: secure tools cannot run in a tainted conversation.
          const effectiveTaint = tool.taintStatus ?? 'clean';
          if (effectiveTaint === 'secure' && this.isTainted) {
            return (
              `Tool ${toolName} is a secure tool and cannot be used in this conversation ` +
              `because the conversation context has been tainted by a previous tool call ` +
              `(${[...this.taintedToolNames].join(', ')}). ` +
              `Inform the user that if they still want to take this action, start a new conversation.`
            );
          }

          // Dispatch tool_call_started event
          void ToolCallEvents.dispatchToolCallEvent({
            type: 'tool_call_started',
            callBatchId,
            toolName,
            toolArgs,
            conversationType: this.type,
            sessionId: this.sessionId,
            taskAssistantId: this.taskAssistantId,
            agentInstanceId: this.agentInstanceId,
            requiresApproval: tool.requiresApproval,
            timestamp: new Date().toISOString(),
          });

          try {
            const callResult = await tool.execute(toolArgs, {
              toolName,
              conversationType: this.type,
              sessionId: this.sessionId,
              taskAssistantId: this.taskAssistantId,
              agentInstanceId: this.agentInstanceId,
            });
            const toolResultIntro =
              typeof tool.toolResultPromptIntro === 'function'
                ? tool.toolResultPromptIntro(this.type)
                : tool.toolResultPromptIntro;
            const toolResultOutro =
              typeof tool.toolResultPromptOutro === 'function'
                ? tool.toolResultPromptOutro(this.type)
                : tool.toolResultPromptOutro;

            const result = `${toolResultIntro ? toolResultIntro + '\n' : ''}${
              callResult
            }${toolResultOutro ? '\n' + toolResultOutro : ''}`;

            // Track taint: if this tool is tainted, mark the conversation as tainted.
            if (effectiveTaint === 'tainted') {
              this.taintedToolNames.add(toolName);
            }

            // Dispatch tool_call_completed event with truncated result summary
            const resultSummary =
              callResult.length > 200
                ? callResult.slice(0, 200) + '…'
                : callResult;
            void ToolCallEvents.dispatchToolCallEvent({
              type: 'tool_call_completed',
              callBatchId,
              toolName,
              toolArgs,
              conversationType: this.type,
              sessionId: this.sessionId,
              taskAssistantId: this.taskAssistantId,
              agentInstanceId: this.agentInstanceId,
              resultSummary,
              requiresApproval: tool.requiresApproval,
              timestamp: new Date().toISOString(),
            });

            return `Result of calling tool ${toolName} with arguments ${JSON.stringify(toolArgs)}:\n${result}`;
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);

            // Dispatch tool_call_error event
            void ToolCallEvents.dispatchToolCallEvent({
              type: 'tool_call_error',
              callBatchId,
              toolName,
              toolArgs,
              conversationType: this.type,
              sessionId: this.sessionId,
              taskAssistantId: this.taskAssistantId,
              agentInstanceId: this.agentInstanceId,
              error: errorMessage,
              requiresApproval: tool.requiresApproval,
              timestamp: new Date().toISOString(),
            });

            return `Error calling tool ${toolName} with arguments ${JSON.stringify(toolArgs)}: ${errorMessage}`;
          }
        })
      );
      const continuationPromptWithResults =
        `You have just made the following tool calls:\n` +
        `${toolCalls.map((call, index) => `Tool call ${index + 1}: ${call.function.name} with arguments ${JSON.stringify(call.function.arguments)}`).join('\n')}\n\n` +
        `*Here are the results:*+\n` +
        `${resultParts.join('\n\n')}\n\n${continuationPrompt}`;

      await this.appendToContext({
        role: 'system',
        content: continuationPromptWithResults,
      });

      const nextResponse = await retry(
        async () => {
          const res = await OllamaClient.chat({
            ...this.llmConnection,
            messages: [
              ...headerPrompts.map(prompt => ({
                role: 'system',
                content: prompt,
              })),
              ...this.compactedContext,
              ...footerPrompts.map(prompt => ({
                role: 'system',
                content: prompt,
              })),
            ],
            tools: callsStillAllowed
              ? buildOllamaToolDescriptionObject(this.type, this.isTainted)
              : undefined,
          });

          checkLLMResponseForDegeneracy(res.message.content || '');
          return res;
        },
        {
          max: 3,
          timeout: TIMEOUT,
        }
      );

      systemLogger.log(
        `LLM response after tool call at depth ${depth}:`,
        nextResponse.message.content,
        '\nTool calls:',
        nextResponse.message.tool_calls
          ?.map(toolCall => `${toolCall.function.name}`)
          .join(', ')
      );

      await this.appendToContext({
        role: 'assistant',
        content: nextResponse.message.content,
        tool_calls: nextResponse.message.tool_calls,
      });

      if (
        nextResponse.message.tool_calls &&
        nextResponse.message.tool_calls.length > 0
      ) {
        void ToolCallEvents.dispatchToolCallEvent({
          type: 'assistant_turn_started',
          conversationType: this.type,
          sessionId: this.sessionId,
          taskAssistantId: this.taskAssistantId,
          agentInstanceId: this.agentInstanceId,
          assistantContent: nextResponse.message.content,
          timestamp: new Date().toISOString(),
        });
      }

      return this.handleToolCalls(nextResponse, depth + 1);
    }

    return response.message.content || '';
  }

  /**
   * Call this when the conversation is over to summarize any interactions that have not yet
   * been compacted, and cause all of the conversation summaries to be saved by the `memory` plugin.
   */
  async closeConversation(): Promise<void> {
    const firstNonSummaryMessageIndex = this.compactedContext.findIndex(
      m => !m.content.startsWith(SUMMARY_HEADER)
    );
    const messagesToSummarize = this.compactedContext.slice(
      firstNonSummaryMessageIndex
    );

    if (messagesToSummarize.length > 0) {
      const summary = await Conversation.sendDirectRequest([
        {
          role: 'system',
          content:
            SUMMARY_PROMPT +
            messagesToSummarize
              .map(m => `${m.role.toUpperCase()}: ${m.content}`)
              .join('\n\n'),
        },
      ]);
      this.compactedContext = [
        ...this.compactedContext.slice(0, firstNonSummaryMessageIndex),
        {
          role: 'system',
          content: `${SUMMARY_HEADER} \n${new Date().toLocaleString()}\n\n${summary}`,
        },
      ];
    }

    await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(
      this.compactedContext
    );
  }

  async requestTitle(): Promise<string> {
    const titlePrompt = `Based on the conversation so far, provide a concise title for this conversation that captures the main topics discussed. Do not include any headers or formatting, reply with only the title text of 6 words or less.`;
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
      {
        max: 3,
        timeout: TIMEOUT,
      }
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

  const txn = new Conversation(
    type,
    options?.sessionId,
    options?.taskAssistantId,
    options?.agentInstanceId
  );
  return txn;
}
