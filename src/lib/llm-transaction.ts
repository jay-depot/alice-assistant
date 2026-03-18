import OllamaClient from 'ollama';
import { UserConfig } from './user-config';

const MAX_TOOL_CALL_DEPTH = 5;
type Message = {
  role: string;
  content: string;
};

export class LlmTransaction {
  private llmConnection = {
    host: '',
    model: '',
    options: {
      num_ctx: 16000
    },
  }

  private context: Message[] = [];

  constructor() {
    this.llmConnection = {
      ...this.llmConnection,
      host: UserConfig.getConfig().ollama.host,
      model: UserConfig.getConfig().ollama.model
    }

    if (UserConfig.getConfig().ollama.options) {
      this.llmConnection.options = UserConfig.getConfig().ollama.options;
    }
  }

  async executeTurn(prompt: string): Promise<string> {
    this.context.push({
      "role": "user",
      "content": prompt
    });

    const response = await OllamaClient.chat({
      ...this.llmConnection,
      messages: this.context
    });

    if (response && response.message.content && response.message.content.length > 0) {
      
      //TODO: Tool calling check

      this.context.push({
        role: "assistant",
        content: response.message.content
      });

      return response.message.content;
    }
    
    throw new Error('Empty response from LLM');
  }

  private async handleToolCalls(responseContent: string, depth = 0): Promise<string> {
    // Check if the response content is a tool call. If it is, execute the tool call and send the 
    // appropriate "tool response" prompt back to the LLM, then wait for the next response. If it's 
    // not a tool call, just return the response content.

    if (depth > MAX_TOOL_CALL_DEPTH) {
      throw new Error('Maximum tool call depth exceeded. Possible infinite loop detected.');
    }

    // here is where we extract, parse and execute the tool call, and then construct the appropriate prompt
    // to send back to the LLM with the tool results and instructions for how to proceed.

    const promptIfCallsAvailable = ` - If you would need to make another tool call, output ONLY the call signature. Otherwise, answer the user's query in character. You have ${MAX_TOOL_CALL_DEPTH - depth} remaining recursive tool calls you may make regarding this user query.`;
    const promptIfNoCallsAvailable =  ` - You may make no more recursive tool calls for this conversation turn, so you must answer the user's query in character.\n` +
      ` - If you still do not have sufficient information to form a complete answer, you have two options: \n` +
      `   1) Do your best with the information you have, or \n` +
      `   2) If you are missing a specific piece of information that would be critical to forming a complete answer, ask the user in character ` +
      `if you can continue looking. If they agree, you may use the new quota of 5 recursive tool calls for the next round of conversation to continue.`;

    const continuationPrompt = depth > 0 ? promptIfCallsAvailable: promptIfNoCallsAvailable;

    // Here is where we send the continuation prompt, and wait for the next response, which may be another tool call, 
    // or it may be the final answer to return to the caller.
    // If it is another tool call, we need to recursively call handleToolCalls again, with the new response content and an incremented depth
    // otherwise, we just return the LLM's response to the caller..
  
    return '';
  }

  async concludeTransactionWithSummary(): Promise<string> {
    const terminationPrompt = `The user has terminated the assistant session. The assistant software now needs you to abandon your persona and summarize the conversation to provide context in future requests.

 - Include no headers
 - Include no footers
 - Return only a bulleted, unnumbered list of conversation turns from this interaction with a summary of all user requests and your responses in chronological order
 - You will be able to use this summary in future conversations for context
 - There is no need to mention this request for archival in your summary, the relevant processes which will use it already know that
 - Remain neutral and objective in your summary
 - There is no need for an end marker for this session, it will be added for you
`;
    // Send the termination prompt, and wait for the response, which will be the conversation summary.
    // Return the conversation summary to the caller, so it can be stored and used for future context.
    return '';
  }
}

export function startLLMTransaction(): LlmTransaction {
  const txn = new LlmTransaction();
  return txn;
}
