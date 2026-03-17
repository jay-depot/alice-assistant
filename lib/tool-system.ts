type ToolPromptFragmentFunction =  string | (() => string);

export type Tool = {
  name: string;
  description: string;
  systemPromptFragment: ToolPromptFragmentFunction; // This is the fragment that will be added to the system prompt to describe the tool and how to use it.
  callSignature: string; // This is the exact string that the LLM should output when it wants to call the tool. It should be unique enough that it won't be accidentally generated in normal conversation.
  toolResultPromptIntro: ToolPromptFragmentFunction; // This is the prompt fragment used as a "preamble" when the LLM receives the result of a tool call. It should be used to instruct the LLM on how to use the tool result in its response, and to remind it of any relevant context about the tool or the scenario that might have been lost during the tool call.
  toolResultPromptOutro: ToolPromptFragmentFunction; // This is the prompt fragment used as a "postamble" when the LLM receives the result of a tool call. It can also be used to provide additional instructions or context to the LLM on how to present the results. The part that tells the LLM to make another tool call or "respond in character" is appended to this automatically, so don't include it.
  execute: (args: Record<string, string>) => Promise<string>; // This is the function that will be called when the LLM outputs the call signature. It will receive the arguments as a JSON object, and should return the result of the tool call as a JSON object.
}
