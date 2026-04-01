import { TSchema } from 'typebox';
import { getTools } from './tools.js';
import { DynamicPromptConversationType } from './dynamic-prompt.js';

type ToolPromptFragmentFunction =  string | (() => string);

type OllamaRequestToolsPropItem = {
  'type': 'function';
  'function': {
    name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Temporary until typebox is added
    parameters: Record<string, any>; // TODO Since this is a JSON schema, we may as well use typebox to generate them easily
    description: string;
  };
};

export type Tool = {
  name: string;
  // The contexts in which the LLM will have access to the tool.
  // - 'autonomy' means the tool can be used when the assistant is woken up by events or
  //   timers. Grant this only if the tool is 'read-only' or only writes to the assistant's
  //   own internal state.
  // - 'chat-session' means the tool can be used in response to user messages in a chat session.
  //   Most tools you'd allow here also make sense for voice, but tools that do things like change
  //   the chat interface itself should only be enabled for chat and not voice.
  // - 'voice-session' means the tool can be used in response to user messages in a voice session.
  //   Almost all tools should be available in this context, as we're responding directly to user
  //   messages. The only exception to this would be tools that directly modify a specific interface.
  //   Tools that should be voice-only would be those that modify voice delivery itself, like
  //   alternate voices.
  availableFor: DynamicPromptConversationType[]; 
  // A short description of the tool, used in the system prompt (and one day, the UI) to help 
  // the user understand what the tool does.
  description: string;
  // This is the fragment that will be added to the system prompt to describe the tool and how to use it.
  systemPromptFragment: ToolPromptFragmentFunction; 
  // The parameters for the tool, as a JSON schema. This project incorporates typebox, so you 
  // should use that to define the parameters and the tool's function signature together..
  parameters: TSchema,
  // This is the prompt fragment used as a "preamble" when the LLM receives the result of a tool call. 
  // It should be used to instruct the LLM on how to use the tool result in its response.
  toolResultPromptIntro: ToolPromptFragmentFunction; 
  // This is the prompt fragment used as a "postamble" when the LLM receives the result of a tool call. 
  // It can be used to provide additional instructions or context to the LLM on how to present the 
  // results. The part that tells the LLM to make another tool call or "respond in character" is 
  // appended to this automatically, so don't include it.
  toolResultPromptOutro: ToolPromptFragmentFunction; 
  // This is the function that will be called when the LLM outputs the call signature. It will 
  // receive the arguments as a JSON object, and should return the result of the tool call as a 
  // JSON object.
  execute: (args: Record<string, unknown>) => Promise<string>; 
}

export function buildOllamaToolDescriptionObject(conversationType: DynamicPromptConversationType): OllamaRequestToolsPropItem[] {
  const tools = getTools(conversationType);
  return tools.map(tool=>({
    type: 'function',
    function: {
      name: tool.name,
      parameters: tool.parameters,
      description: tool.description
    }
  }));
}
