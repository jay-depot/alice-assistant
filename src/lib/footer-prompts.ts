import { DynamicPrompt, DynamicPromptContext, processDynamicPrompts } from './dynamic-prompt.js';

import { datetimeFooterPrompt } from './system-prompts/footers/datetime-footer.js';


const footerPrompts: DynamicPrompt[] = [datetimeFooterPrompt];

export async function getFooterPrompts(context: DynamicPromptContext): Promise<string[]> {
  return processDynamicPrompts(context, footerPrompts);
}
