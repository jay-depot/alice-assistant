import { DynamicPrompt, DynamicPromptContext, processDynamicPrompts } from './dynamic-prompt.js';
import { scenarioHeaderPrompt } from './system-prompts/headers/scenario-header.js';
import { toolsHeaderPrompt } from './system-prompts/headers/tools-header.js';

const headerPrompts: DynamicPrompt[] = [scenarioHeaderPrompt, toolsHeaderPrompt];

export async function getHeaderPrompts(context: DynamicPromptContext): Promise<string[]> {
  return processDynamicPrompts(context, headerPrompts.filter(prompt => context.toolCallsAllowed !== false || prompt.name !== 'toolsHeader'));
}

export function addHeaderPrompt(prompt: DynamicPrompt) {
  headerPrompts.push(prompt);
}
