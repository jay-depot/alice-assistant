import OllamaClient, { ChatResponse } from 'ollama';
import { UserConfig } from './user-config';
import { buildOllamaToolDescriptionObject } from './tool-system';
import { getTools } from '../tools';

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

    const promptIfCallsAvailable = ` - If you would need to make another tool call, output ONLY the call signature. Otherwise, answer the user's query in character. You have ${MAX_TOOL_CALL_DEPTH - depth} remaining recursive tool calls you may make regarding this user query.`;
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
