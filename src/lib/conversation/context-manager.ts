import OllamaClient from 'ollama';
import { retryAsPromised as retry } from 'retry-as-promised';
import { systemLogger } from '../system-logger.js';
import { PluginHookInvocations } from '../plugin-hooks.js';
import {
  SUMMARY_HEADER,
  SUMMARY_PROMPT,
  checkLLMResponseForDegeneracy,
} from './degeneracy-check.js';
import type { Message } from './types.js';
import type { DynamicPromptConversationType } from '../dynamic-prompt.js';

const CONTEXT_LENGTH_FRACTION = 0.25;
const MAX_SUMMARY_RETRIES = 3;
const TIMEOUT = undefined;

export type LlmConnectionDetails = {
  host: string;
  model: string;
  options: {
    num_ctx: number;
  };
};

export type SummarizerFn = (messages: Message[]) => Promise<string>;

export interface IConversationHost {
  rawContext: Message[];
  compactedContext: Message[];
  type: DynamicPromptConversationType;
}

export class ConversationContextManager {
  private conv: IConversationHost;
  private llmConnection: LlmConnectionDetails;
  private summarizer: SummarizerFn;
  private synchronizedRawMessageCount = 0;

  constructor(
    conversation: IConversationHost,
    llmConnection: LlmConnectionDetails,
    summarizer: SummarizerFn
  ) {
    this.conv = conversation;
    this.llmConnection = llmConnection;
    this.summarizer = summarizer;
  }

  restoreContext(context: Message[], compactedContext?: Message[]): void {
    if (this.conv.rawContext.length > 0) {
      throw new Error(
        'Context has already been set for this transaction. Cannot restore context more than once.'
      );
    }

    this.conv.compactedContext = [...(compactedContext || context)];
    this.conv.rawContext = [...context];
    this.synchronizedRawMessageCount = this.conv.rawContext.length;
  }

  getUnsynchronizedMessages(): Message[] {
    return this.conv.rawContext.slice(this.synchronizedRawMessageCount);
  }

  markUnsynchronizedMessagesSynchronized(): void {
    this.synchronizedRawMessageCount = this.conv.rawContext.length;
  }

  appendToContext(message: Message): Promise<boolean> {
    this.conv.rawContext.push(message);
    this.conv.compactedContext.push(message);

    return this.maybeCompactContext();
  }

  async compactContext(mode: 'normal' | 'full' | 'clear'): Promise<boolean> {
    if (mode === 'normal') {
      return this.maybeCompactContext();
    }

    if (mode === 'full' || mode === 'clear') {
      return this.fullOrClearCompact(mode);
    }

    return false;
  }

  async closeConversation(): Promise<void> {
    const firstNonSummaryMessageIndex = this.conv.compactedContext.findIndex(
      m => !m.content.startsWith(SUMMARY_HEADER)
    );
    const messagesToSummarize = this.conv.compactedContext.slice(
      firstNonSummaryMessageIndex
    );

    if (messagesToSummarize.length > 0) {
      const summary = await this.summarizer(messagesToSummarize);
      this.conv.compactedContext = [
        ...this.conv.compactedContext.slice(0, firstNonSummaryMessageIndex),
        {
          role: 'system',
          content: `${SUMMARY_HEADER} \n${new Date().toLocaleString()}\n\n${summary}`,
        },
      ];
    }

    const summaryMessages = this.conv.compactedContext.filter(m =>
      m.content.startsWith(SUMMARY_HEADER)
    );
    await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(
      summaryMessages,
      this.conv.type
    );
  }

  // ── private helpers ────────────────────────────────────────────────

  private async maybeCompactContext(): Promise<boolean> {
    const approximateContextLength = this.conv.compactedContext.reduce(
      (acc, message) => acc + message.content.split(' ').length,
      0
    );
    const contextLengthThreshold =
      (this.llmConnection.options.num_ctx ?? 16000) * CONTEXT_LENGTH_FRACTION;

    if (approximateContextLength <= contextLengthThreshold) {
      return false;
    }

    const firstNonSummaryMessageIndex = this.conv.compactedContext.findIndex(
      m => !m.content.startsWith(SUMMARY_HEADER)
    );
    const nonSummaryMessages = this.conv.compactedContext.slice(
      firstNonSummaryMessageIndex
    );
    const messageCount = nonSummaryMessages.length;

    const messagesToSummarize = nonSummaryMessages.slice(
      0,
      Math.floor(messageCount / 2)
    );

    const summary = await this.runSummaryRequest(messagesToSummarize);
    this.conv.compactedContext = [
      ...this.conv.compactedContext.slice(0, firstNonSummaryMessageIndex),
      {
        role: 'system',
        content: `${SUMMARY_HEADER} \n${new Date().toLocaleString()}\n\n${summary}`,
      },
      ...this.conv.compactedContext.slice(
        firstNonSummaryMessageIndex + messagesToSummarize.length
      ),
    ];

    systemLogger.debug(`Conversation summary generated:\n${summary}`);

    // Check if compacted context is still too long — evict oldest summaries
    const newApproximateContextLength = this.conv.compactedContext.reduce(
      (acc, message) => acc + message.content.split(' ').length,
      0
    );

    if (newApproximateContextLength > contextLengthThreshold) {
      const summariesToDelete = this.conv.compactedContext
        .filter(m => m.content.startsWith(SUMMARY_HEADER))
        .slice(0, Math.floor(messageCount / 4));
      await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(
        summariesToDelete,
        this.conv.type
      );
    }

    return true;
  }

  private async fullOrClearCompact(mode: 'full' | 'clear'): Promise<boolean> {
    const firstNonSummaryMessageIndex = this.conv.compactedContext.findIndex(
      m => !m.content.startsWith(SUMMARY_HEADER)
    );

    if (firstNonSummaryMessageIndex === -1) {
      if (mode === 'clear' && this.conv.compactedContext.length > 0) {
        await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(
          this.conv.compactedContext,
          this.conv.type
        );
        this.conv.compactedContext = [];
      }
      return false;
    }

    const messagesToSummarize = this.conv.compactedContext.slice(
      firstNonSummaryMessageIndex
    );

    if (messagesToSummarize.length === 0) {
      if (mode === 'clear' && firstNonSummaryMessageIndex > 0) {
        await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(
          this.conv.compactedContext,
          this.conv.type
        );
        this.conv.compactedContext = [];
      }
      return false;
    }

    const summary = await this.summarizer(messagesToSummarize);

    systemLogger.debug(`Conversation summary generated:\n${summary}`);

    const newSummary: Message = {
      role: 'system',
      content: `${SUMMARY_HEADER} \n${new Date().toLocaleString()}\n\n${summary}`,
    };

    if (mode === 'full') {
      this.conv.compactedContext = [
        ...this.conv.compactedContext.slice(0, firstNonSummaryMessageIndex),
        newSummary,
      ];
    } else {
      // mode === 'clear'
      const allSummaries = [
        ...this.conv.compactedContext.slice(0, firstNonSummaryMessageIndex),
        newSummary,
      ];
      await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(
        allSummaries,
        this.conv.type
      );
      this.conv.compactedContext = [];
    }

    return true;
  }

  private async runSummaryRequest(messages: Message[]): Promise<string> {
    const summaryPrompt =
      SUMMARY_PROMPT +
      messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

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
        max: MAX_SUMMARY_RETRIES,
        timeout: TIMEOUT,
      }
    );

    return summaryResponse.message.content || '';
  }
}
