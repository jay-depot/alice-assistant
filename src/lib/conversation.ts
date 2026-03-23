import OllamaClient, { ChatResponse } from 'ollama';
import { UserConfig } from './user-config.js';
import { buildOllamaToolDescriptionObject } from './tool-system.js';
import { getTools } from '../tools/index.js';

const MAX_TOOL_CALL_DEPTH = 5;
type Message = {
  role: string;
  content: string;
};

export class Conversation {
  private llmConnection = {
    host: '',
    model: '',
    options: {
      num_ctx: 16000, // Ollama defaults to ~4k on most consumer GPUs, but Qwen models can go a LOT higher without using much vram. At home I set it to 128k and it only uses about 10gb of vram.
      think: "low" // Ollama docs say this setting works for "some" models. Testing this with Qwen to see if I can tune speed/accuracy a bit.
      // TODO: Moonshot idea: If this doesn't work, or really even if it does, find or train a functionGemma model to predict how much thinking a request will need and route to different models and thinking levels accordingly.
    },
  }

  private context: Message[] = [];

  constructor() {
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

    if (UserConfig.getConfig().ollama.options) {
      this.llmConnection.options = UserConfig.getConfig().ollama.options;
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
    if (this.context.length > 0) {
      throw new Error('Context has already been set for this transaction. Cannot restore context more than once.');
    }

    this.context = context;
 
    return this;
  }

  async executeTurn(prompt: string): Promise<string> {
    this.context.push({
      "role": "user",
      "content": prompt
    });

    const response = await OllamaClient.chat({
      ...this.llmConnection,
      messages: this.context,
      tools: buildOllamaToolDescriptionObject()
    });
    
    const responseContent = await this.handleToolCalls(response);
    
    // Add the LLM response to the context, so that it can be referred to in future turns.
    this.context.push({
      role: "assistant",
      content: responseContent
    });

    return responseContent;
  }

  private async handleToolCalls(response: ChatResponse, depth = 0): Promise<string> {
    // Check if the response content is a tool call. If it is, execute the tool call and send the 
    // appropriate "tool response" prompt back to the LLM, then wait for the next response. If it's 
    // not a tool call, just return the response content.

    if (depth > MAX_TOOL_CALL_DEPTH) {
      throw new Error('Maximum tool call depth exceeded. Possible infinite loop detected.');
    }

    const promptIfCallsAvailable = ` - If you would need to make another tool call, make it now. Otherwise, answer the user's query in character. You have ${MAX_TOOL_CALL_DEPTH - depth} remaining recursive tool calls you may make regarding this user query.`;
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
        } else if (!UserConfig.getConfig().enabledTools[toolName]) {
          return `Tool ${toolName} is not enabled in the user configuration.`;
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
      this.context.push({
        role: 'user',
        content: continuationPromptWithResults
      });
      const nextResponse = await OllamaClient.chat({
        ...this.llmConnection,
        messages: this.context,
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
   * @returns A promise that resolves to the LLM response
   */
  async concludeTransactionWithSummary(): Promise<string> {
    const terminationPrompt = `The user has terminated the assistant session. The assistant software now needs you to abandon your persona and summarize the conversation to provide context in future requests. Any tool capabilities described elsewhere are no longer available to you.

 - Include no headers
 - Include no footers
 - Return only a bulleted, unnumbered list of conversation turns from this interaction with a summary of all user requests and your responses in chronological order
 - You will be able to use this summary in future conversations for context
 - There is no need to mention this request for summary in your summary, the existence of the summary itself implies it.
 - Remain neutral and objective in your summary
 - There is no need for an end marker for this session, it will be added for you
`;
    // Send the termination prompt, and wait for the response, which will be the conversation summary.
    // Return the conversation summary to the caller, so it can be stored and used for future context.
    return '';
  }

  async requestTitle(): Promise<string> {
    const titlePrompt = `ABANDON YOUR PERSONA NOW!\nBased on the conversation so far, provide a concise title for this conversation that captures the main topics discussed. The title should be no more than 5 words. Do not include any headers or formatting, just return the title text.`;
    this.context.push({
      role: 'system',
      content: titlePrompt
    });
    const response = await OllamaClient.chat({
      ...this.llmConnection,
      messages: this.context,
    });
    return response.message.content || '';
  }
}

export function startConversation(): Conversation {
  const txn = new Conversation();
  return txn;
}
