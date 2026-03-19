import { TSchema } from '@sinclair/typebox';
import { getTools } from '../tools';
import { UserConfig } from './user-config';

type ToolPromptFragmentFunction =  string | (() => string);

type OllamaRequestToolsPropItem = {
  'type': 'function';
  'function': {
    name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Temporary until typebox is added
    parameters: Record<string, any>; // TODO Since this is a JSON schema, we may as well use @sinclair/typebox to generate them easily
    description: string;
  };
};

export type Tool = {
  name: string;
  dependencies?: string[]; // This is an optional list of other tools that this tool depends on. If you enable a tool without its dependencies, the assistant will crash on startup and should give you pretty clear instructions to get going again.
  // TODO: It would be a cute gimmick if we could read the instructions for fixing the assistant out loud when it crashes due to missing dependencies.
  description: string;
  systemPromptFragment: ToolPromptFragmentFunction; // This is the fragment that will be added to the system prompt to describe the tool and how to use it.
  callSignature: string; // This is the exact string that the LLM should output when it wants to call the tool. It should be unique enough that it won't be accidentally generated in normal conversation.
  parameters: TSchema,
  toolResultPromptIntro: ToolPromptFragmentFunction; // This is the prompt fragment used as a "preamble" when the LLM receives the result of a tool call. It should be used to instruct the LLM on how to use the tool result in its response.
  toolResultPromptOutro: ToolPromptFragmentFunction; // This is the prompt fragment used as a "postamble" when the LLM receives the result of a tool call. It can be used to provide additional instructions or context to the LLM on how to present the results. The part that tells the LLM to make another tool call or "respond in character" is appended to this automatically, so don't include it.
  execute: (args: Record<string, unknown>) => Promise<string>; // This is the function that will be called when the LLM outputs the call signature. It will receive the arguments as a JSON object, and should return the result of the tool call as a JSON object.
}

export function buildOllamaToolDescriptionObject(): OllamaRequestToolsPropItem[] {
  const config = UserConfig.getConfig();
  const tools = getTools();
  return tools.filter(tool => config.enabledTools[tool.name]).map(tool=>({
    type: 'function',
    function: {
      name: tool.name,
      parameters: tool.parameters,
      description: tool.description
    }
  }));
}
