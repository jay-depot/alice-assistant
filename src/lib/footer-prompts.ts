import { DynamicPrompt, DynamicPromptContext, processDynamicPrompts } from './dynamic-prompt.js';

const footerPrompts: DynamicPrompt[] = [];

export async function getFooterPrompts(context: DynamicPromptContext): Promise<string[]> {
  return processDynamicPrompts(context, footerPrompts);
}

export function addFooterPrompt(prompt: DynamicPrompt) {
  footerPrompts.push(prompt);
}
