import { DynamicPrompt, DynamicPromptContext, processDynamicPrompts } from './dynamic-prompt.js';
import { personalityHeaderPrompt } from './system-prompts/headers/personality-header.js';
import { scenarioHeaderPrompt } from './system-prompts/headers/scenario-header.js';
import { toolsHeaderPrompt } from './system-prompts/headers/tools-header.js';

const headerPrompts: DynamicPrompt[] = [personalityHeaderPrompt, scenarioHeaderPrompt, toolsHeaderPrompt];

export async function getHeaderPrompts(context: DynamicPromptContext): Promise<string[]> {
  return processDynamicPrompts(context, headerPrompts);
}
