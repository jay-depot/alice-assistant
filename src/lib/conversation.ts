import OllamaClient, { ChatResponse } from 'ollama';
import { UserConfig } from './user-config.js';
import { buildOllamaToolDescriptionObject } from './tool-system.js';
import { getTools } from './tools.js';
import { DynamicPromptConversationType } from './dynamic-prompt.js';
import { getHeaderPrompts } from './header-prompts.js';
import { getFooterPrompts } from './footer-prompts.js';

const MAX_TOOL_CALL_DEPTH = 5;
type Message = {
  role: string;
  content: string;
  tool_calls?: string; // We're just going to JSON.stringify the tool calls and then deserialize them on the way back.
};

export class Conversation {
  private llmConnection = {
    host: '',
    model: '',
    options: {
      num_ctx: 128000, // Ollama defaults to ~4k on most consumer GPUs, but Qwen models can go a LOT higher without using much vram. At home I set it to 128k and it only uses about 10gb of vram.
      think: "low" // Ollama docs say this setting works for "some" models. Testing this with Qwen to see if I can tune speed/accuracy a bit.
      // TODO: Moonshot idea: If this doesn't work, or really even if it does, find or train a functionGemma model to predict how much thinking a request will need and route to different models and thinking levels accordingly.
    },
  }

  private rawContext: Message[] = [];
  private compactedContext: Message[] = [];

  constructor(public type: DynamicPromptConversationType) {
    this.llmConnection = {
      ...this.llmConnection,
      host: UserConfig.getConfig().ollama.host,
      model: UserConfig.getConfig().ollama.model,
      options: {
        ...this.llmConnection.options,
        // allow the user to override settings like context window size, thinking time, temperature, etc. in the config, while being able to provide "sensible" defaults.
        ...UserConfig.getConfig().ollama.options,
      }
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
  restoreContext(context: Message[]) {
    // Let's disarm a common foot-gun right off the bat.
    if (this.rawContext.length > 0) {
      throw new Error('Context has already been set for this transaction. Cannot restore context more than once.');
    }

    this.compactedContext = this.rawContext = context;
 
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
   * with the summary.
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
      // We need to compact the context. Let's take the oldest 10 messages and summarize them.
      const firstNonSummaryMessageIndex = this.compactedContext.findIndex(m => !m.content.startsWith('Summary of earlier conversation:'));
      const messageCount = this.compactedContext.slice(firstNonSummaryMessageIndex).length;
      // We'll do half the messages.

      const messagesToSummarize = this.compactedContext.slice(firstNonSummaryMessageIndex, 
        firstNonSummaryMessageIndex + Math.floor(messageCount / 2));

      // 
      const summaryPrompt = `Summarize the following conversation between the user and the ` +
        `assistant in a way that preserves all relevant information and details, but is as ` +
        `concise as possible. The summary should be in bullet point format, with each bullet ` +
        `point representing a single turn in the conversation. Be sure to include all ` +
        `relevant details and information from the conversation, but remove any fluff ` +
        `or filler content. Be especially certain to include any proper names, tasks with ` +
        `their statuses, and code samples, if applicable, in your summary. The summary will ` +
        `be used to provide context for future conversation turns, so it should be as ` +
        `informative as possible while still being concise.` +
        `\n\nConversation:\n\n${messagesToSummarize.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}`;

      const summaryResponse = await OllamaClient.chat({
        ...this.llmConnection,
        messages: [
          { role: 'system', content: summaryPrompt }
        ],
      });

      const summary = summaryResponse.message.content || '';
      // Now we need to replace the oldest 10 messages in the context with the summary.
      this.compactedContext = [
        // Keep any existing summary messages. Hopefully nobody keeps one conversation open 
        // *that* long. Yes, I'm looking at *you*. but seriously, these should get 
        // meta-summarized when there are too many of them.
        ...this.compactedContext.slice(0, firstNonSummaryMessageIndex), 
        { role: 'system', content: `# Summary of earlier conversation:\n${(new Date()).toLocaleString()}\n\n${summary}` },
        ...this.compactedContext.slice(firstNonSummaryMessageIndex + messagesToSummarize.length)
      ];
      return true;
    }

    return false;
  }

  async sendUserMessage(message?: string): Promise<string> {
    const headerPrompts = await getHeaderPrompts({ conversationType: this.type });
    const footerPrompts = await getFooterPrompts({ conversationType: this.type });

    if (message) {
      await this.appendToContext({
        role: 'user',
        content: message
      });
    }

    const fullContext = [
      ...headerPrompts.map(prompt => ({ role: 'system', content: prompt })),
      ...this.compactedContext,
      ...footerPrompts.map(prompt => ({ role: 'system', content: prompt })),
    ];

    const response = await OllamaClient.chat({
      ...this.llmConnection,
      messages: fullContext,
      tools: buildOllamaToolDescriptionObject()
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
        const tools = getTools();
        const tool = tools.find(t => t.name === toolName);
        if (!tool) {
          return `Tool ${toolName} is not recognized.`;
        }
        try {
          const result = await tool.execute(toolArgs);
          return `Result of calling tool ${toolName} with arguments ${JSON.stringify(toolArgs)}: ${result}`;
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
      const nextResponse = await OllamaClient.chat({
        ...this.llmConnection,
        messages: this.compactedContext.map(message => ({
          role: message.role,
          content: message.content,
          tool_calls: message.tool_calls ? JSON.parse(message.tool_calls) : undefined
        })),
        tools: buildOllamaToolDescriptionObject()
      });

      return this.handleToolCalls(nextResponse, depth + 1);
    }

    return response.message.content || '';
  }

  /**
   * Instructs the LLM to abandon its assistant persona and summarize the interaction. Use this 
   * to implement the memory feature by calling it at the end of any voice or web UI conversation
   * and storing the resulting summary in the database, with keywords extracted.
   * 
   * @todo: This currently has the LLM summarize the "compacted" context, which is kind of 
   * silly. It would be better to have the LLM only summarize the "unsummarized" messages, 
   * and then just glue them to the end of the existing summary.
   * 
   * @returns A promise that resolves to the LLM response
   */
  async requestSummary(): Promise<string> {
    const headerPrompts = await getHeaderPrompts({ conversationType: this.type });
    const footerPrompts = await getFooterPrompts({ conversationType: this.type });

    const terminationPrompt = `The user has terminated the assistant session. The assistant software now needs you to abandon your persona and summarize the conversation to provide context in future requests.

 - Include no headers
 - Include no footers
 - Return only a bulleted, unnumbered list of conversation turns from this interaction with a summary of all user requests and your responses in chronological order
 - You will be able to use this summary in future conversations for context
 - There is no need to mention this request for summary in your summary, the existence of the summary itself implies it.
 - Remain neutral and objective in your summary
 - There is no need for an end marker for this session, it will be added for you
`;
    const fullContext = [
      ...headerPrompts.map(prompt => ({ role: 'system', content: prompt })),
      ...this.compactedContext,
      { role: 'system', content: terminationPrompt },
      ...footerPrompts.map(prompt => ({ role: 'system', content: prompt }))
    ];
    // Send the termination prompt, and wait for the response, which will be the conversation summary.
    const summaryResponse = await OllamaClient.chat({
      ...this.llmConnection,
      messages: fullContext,
    });
    // Return the conversation summary to the caller, so it can be stored and used for future context.
    return summaryResponse.message.content || '';
  }

  async requestTitle(): Promise<string> {
    const titlePrompt = `ABANDON YOUR PERSONA NOW!\nBased on the conversation so far, provide a concise title for this conversation that captures the main topics discussed. The title should be no more than 5 words. Do not include any headers or formatting, just return the title text.`;
    await this.appendToContext({
      role: 'system',
      content: titlePrompt
    });
    const response = await OllamaClient.chat({
      ...this.llmConnection,
      messages: this.compactedContext.map(message => ({
        role: message.role,
        content: message.content,
        tool_calls: message.tool_calls ? JSON.parse(message.tool_calls) : undefined
      })),
      tools: buildOllamaToolDescriptionObject()
    });
    return response.message.content.replaceAll(/(\n|\r)/g, ' ').replaceAll(/(\*|\#|\")/g, '') || '';
  }
}

export function startConversation(type: DynamicPromptConversationType): Conversation {
  const txn = new Conversation(type);
  return txn;
}
