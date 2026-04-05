import OllamaClient, { ChatResponse } from 'ollama';
import { UserConfig } from './user-config.js';
import { buildOllamaToolDescriptionObject } from './tool-system.js';
import { getTools } from './tools.js';
import { DynamicPromptConversationType } from './dynamic-prompt.js';
import { getHeaderPrompts } from './header-prompts.js';
import { getFooterPrompts } from './footer-prompts.js';
import { PluginHookInvocations } from './plugin-hooks.js';
import { retryAsPromised as retry } from 'retry-as-promised';

export const SUMMARY_HEADER = '# Summary of earlier conversation:\n';
const SUMMARY_PROMPT = `Summarize the following conversation between the user and the ` +
  `assistant in a way that preserves all relevant information and details, but is as ` +
  `concise as possible. The summary should be in bullet point format, with each bullet ` +
  `point representing a single turn in the conversation. Be sure to include all ` +
  `relevant details and information from the conversation, but remove any fluff ` +
  `or filler content. Be especially certain to include any proper names, tasks with ` +
  `their statuses, and code samples, if applicable, in your summary. The summary will ` +
  `be used to provide context for future conversation turns, so it should be as ` +
  `informative as possible while still being concise.` +
  `\n\nConversation:\n\n`;

const MAX_TOOL_CALL_DEPTH = 5;
export type Message = {
  role: string;
  content: string;
  tool_calls?: string; // We're just going to JSON.stringify the tool calls and then deserialize them on the way back.
};

function getLLMConnection() {
  return {
    host: UserConfig.getConfig().ollama.host,
    model: UserConfig.getConfig().ollama.model,
    options: {
      num_ctx: 36000, // Ollama defaults to ~4k on most consumer GPUs, but Qwen models can go a LOT higher without using much vram. At home I set it to 128k and it only uses about 10gb of vram.
      ...UserConfig.getConfig().ollama.options, // allow the user to override settings like context window size, thinking time, temperature, etc. in the config, while being able to provide "sensible" defaults.
    },
  }
}
export class Conversation {
  static async sendDirectRequest(messages: Message[]): Promise<string> {
    
    const response = await retry(() => OllamaClient.chat({
      ...getLLMConnection(),
      messages: messages.map(message => ({
        role: message.role,
        content: message.content,
        tool_calls: message.tool_calls ? JSON.parse(message.tool_calls) : undefined
      })),
    }), {
      max: 3,
      timeout: 5000,
      report: console.warn,
    });
    return response.message.content || '';
  }

  private llmConnection = {
    host: '',
    model: '',
    options: {
      num_ctx: 36000, // Ollama defaults to ~4k on most consumer GPUs, but Qwen models can go a LOT higher without using much vram. At home I set it to 128k and it only uses about 10gb of vram.
    },
  }

  public rawContext: Message[] = [];
  public compactedContext: Message[] = [];

  constructor(public type: DynamicPromptConversationType) {
    this.llmConnection = {
      ...getLLMConnection(),
    }
  }

  /**
   * Quickly restore an LLM transaction with externally stored context. Returns the same
   * transaction object for easy chaining. Use this for the web interface, not for the
   * voice interface, which should maintain transaction state itself.
   * 
   * @param context The conversation context to restore for this transaction. This should be an array of messages, where each message has a "role" (either "user" or "assistant") and "content" (the text content of the message).
   * @returns the same llmTransaction object for easy chained calling
   */
  restoreContext(context: Message[], compactedContext?: Message[]): Conversation {
    // Let's disarm a common foot-gun right off the bat.
    if (this.rawContext.length > 0) {
      throw new Error('Context has already been set for this transaction. Cannot restore context more than once.');
    }

    this.compactedContext = [...(compactedContext || context)];
    this.rawContext = [...context];
 
    return this;
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
    const approximateContextLength = this.compactedContext.reduce((acc, message) => 
      acc + message.content.split(' ').length, 0);
    // Start compacting once we hit 50% of the context window, so we have room for our 
    // system prompts and the future conversation.
    const contextLengthThreshold = this.llmConnection.options.num_ctx * 0.5; 

    if (approximateContextLength > contextLengthThreshold) {
      const firstNonSummaryMessageIndex = this.compactedContext.findIndex(m => !m.content.startsWith(SUMMARY_HEADER));
      const messageCount = this.compactedContext.slice(firstNonSummaryMessageIndex).length;
      // We'll do half the messages.

      const messagesToSummarize = this.compactedContext.slice(firstNonSummaryMessageIndex, 
        firstNonSummaryMessageIndex + Math.floor(messageCount / 2));

      // This is a pretty standard compaction prompt, it just specifically calls out proper 
      // names tasks and code samples to make sure "assistant-y" things don't get lost.
      const summaryPrompt = SUMMARY_PROMPT + messagesToSummarize.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

      const summaryResponse = await retry(() => OllamaClient.chat({
        ...this.llmConnection,
        messages: [
          { role: 'system', content: summaryPrompt }
        ],
      }), {
        max: 3,
        timeout: 5000,
        report: console.warn,
      });

      const summary = summaryResponse.message.content || '';
      this.compactedContext = [
        // Keep any existing summary messages.
        ...this.compactedContext.slice(0, firstNonSummaryMessageIndex), 
        { role: 'system', content: `${SUMMARY_HEADER} \n${(new Date()).toLocaleString()}\n\n${summary}` },
        ...this.compactedContext.slice(firstNonSummaryMessageIndex + messagesToSummarize.length)
      ];

      // And now, we check if the compacted context is *still* too long. If it is, we're 
      // going to fire off a hook invocation `onContextCompactionSummariesWillBeDeleted` 
      // with the oldest half the summaries, so plugins (memory, by default) can capture 
      // and store them.

      const newApproximateContextLength = this.compactedContext.reduce((acc, message) => 
        acc + message.content.split(' ').length, 0);

      if (newApproximateContextLength > contextLengthThreshold) {
        const summariesToDelete = this.compactedContext.filter(m => m.content.startsWith(SUMMARY_HEADER)).slice(0, Math.floor(messageCount / 4));
        // Fire off the hook invocation with the oldest half the summaries.
        await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(summariesToDelete);
      }


      return true;
    }

    return false;
  }

  async sendUserMessage(userMessage?: string): Promise<string> {
    const headerPrompts = await getHeaderPrompts({ conversationType: this.type });
    const footerPrompts = await getFooterPrompts({ conversationType: this.type });

    if (userMessage) {
      await this.appendToContext({
        role: 'user',
        content: userMessage
      });
    }

    const fullContext = [
      ...headerPrompts.map(prompt => ({ role: 'system', content: prompt })),
      ...this.compactedContext,
      ...footerPrompts.map(prompt => ({ role: 'system', content: prompt })),
    ];

    const response = await retry(() => OllamaClient.chat({
      ...this.llmConnection,
      messages: fullContext,
      tools: buildOllamaToolDescriptionObject(this.type)
    }), {
      max: 3,
      timeout: 5000,
      report: console.warn,
    });

    if (response.message.content && response.message.content.length > 0) {
      await this.appendToContext({
        role: 'assistant',
        content: response.message.content,
        tool_calls: response.message.tool_calls ? JSON.stringify(response.message.tool_calls) : undefined
      });
    }

    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
      // If the LLM made tool calls in its initial response, handle those tool calls and any subsequent responses before returning the final response to the caller.
      return this.handleToolCalls(response);
    }

    return response.message.content || '';
  }

  private async handleToolCalls(response: ChatResponse, depth = 0): Promise<string> {
    // Check if the response content is a tool call. If it is, execute the tool call and send the 
    // appropriate "tool response" prompt back to the LLM, then wait for the next response. If it's 
    // not a tool call, just return the response content.

    if (depth > MAX_TOOL_CALL_DEPTH) {
      throw new Error('Maximum tool call depth exceeded. Possible infinite loop detected.');
    }
    const headerPrompts = await getHeaderPrompts({ conversationType: this.type });
    const footerPrompts = await getFooterPrompts({ conversationType: this.type });
    const promptIfCallsAvailable = ` - If you need to make another tool call, make it now. Otherwise, answer the user's query in character. You have ${MAX_TOOL_CALL_DEPTH - depth} remaining recursive tool calls you may make regarding this user query.`;
    const promptIfNoCallsAvailable =  ` - You may make no more recursive tool calls for this conversation turn, so you must answer the user's query in character.\n` +
      ` - If you still do not have sufficient information to form a complete answer, you have two options: \n` +
      `   1) Do your best with the information you have, or \n` +
      `   2) If you are missing a specific piece of information that would be critical to forming a complete answer, ask the user in character ` +
      `if you can continue looking. If they agree, you may use the new quota of 5 recursive tool calls for the next round of conversation to continue.`;

    const continuationPrompt = depth > 0 ? promptIfCallsAvailable: promptIfNoCallsAvailable;

    const toolCalls = response.message.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const resultParts = await Promise.all(toolCalls.map(async (toolCall) => {
        const toolName = toolCall.function.name;
        const toolArgs = toolCall.function.arguments;
        console.log(JSON.stringify({ toolName, toolArgs }));
        // Double check the tool is actually enabled in the config, and that it actually exists.
        const tools = getTools(this.type);
        const tool = tools.find(t => t.name === toolName);
        if (!tool) {
          return `Tool ${toolName} is not recognized.`;
        }
        try {
          const callResult = await tool.execute(toolArgs)
          const result = `${
            tool.toolResultPromptIntro ? tool.toolResultPromptIntro + '\n': ''
          }${
            callResult
          }${
            tool.toolResultPromptOutro ? '\n' + tool.toolResultPromptOutro : ''
          }`;
          return `Result of calling tool ${toolName} with arguments ${JSON.stringify(toolArgs)}:\n${result}`;
        } catch (e) {
          return `Error calling tool ${toolName} with arguments ${JSON.stringify(toolArgs)}: ${e instanceof Error ? e.message : String(e)}`;
        }
      }));
      const continuationPromptWithResults = `The assistant has made the following tool calls:\n\n${resultParts.join('\n\n')}\n\n${continuationPrompt}`;
      // Send the continuation prompt, and wait for the next response, which will be the LLM either making another tool call, or giving its final answer.
      await this.appendToContext({
        role: 'system',
        content: continuationPromptWithResults
      });

      const nextResponse = await retry(() => OllamaClient.chat({
        ...this.llmConnection,
        messages: [
          ...headerPrompts.map(prompt => ({ role: 'system', content: prompt })),
          ...this.compactedContext,
          ...footerPrompts.map(prompt => ({ role: 'system', content: prompt })),
        ],
        tools: buildOllamaToolDescriptionObject(this.type)
      }), {
        max: 3,
        timeout: 5000,
        report: console.warn,
      });

      return this.handleToolCalls(nextResponse, depth + 1);
    }

    return response.message.content || '';
  }

  /**
   * Call this when the conversation is over to summarize any interactions that have not yet 
   * been compacted, and cause them to be saved by the `memory` plugin.
   */
  async closeConversation(): Promise<void> {
    const firstNonSummaryMessageIndex = this.compactedContext.findIndex(m => !m.content.startsWith(SUMMARY_HEADER));
    const messagesToSummarize = this.compactedContext.slice(firstNonSummaryMessageIndex);

    if (messagesToSummarize.length > 0) {
      const summary = await Conversation.sendDirectRequest([
        { role: 'system', content: SUMMARY_PROMPT + messagesToSummarize.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n') }
      ]);
      this.compactedContext = [
        ...this.compactedContext.slice(0, firstNonSummaryMessageIndex),
        { role: 'system', content: `${SUMMARY_HEADER} \n${(new Date()).toLocaleString()}\n\n${summary}` },
      ];
    }

    await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(this.compactedContext);
  }

  async requestTitle(): Promise<string> {
    const titlePrompt = `Based on the conversation so far, provide a concise title for this conversation that captures the main topics discussed. The title should be no more than 5 words. Do not include any headers or formatting, reply with only the title text.`;
    await this.appendToContext({
      role: 'system',
      content: titlePrompt
    });
    const response = await retry(() => OllamaClient.chat({
      ...this.llmConnection,
      messages: this.compactedContext.map(message => ({
        role: message.role,
        content: message.content,
        tool_calls: message.tool_calls ? JSON.parse(message.tool_calls) : undefined
      })),
      tools: buildOllamaToolDescriptionObject(this.type)
    }), {
      max: 3,
      timeout: 5000,
      report: console.warn,
    });
    return response.message.content.replaceAll(/(\n|\r)/g, ' ').replaceAll(/(\*|#|")/g, '') || '';
  }
}

export function startConversation(type: DynamicPromptConversationType): Conversation {
  const txn = new Conversation(type);
  return txn;
}
