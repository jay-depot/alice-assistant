import { DynamicPrompt, DynamicPromptContext, processDynamicPrompts } from './dynamic-prompt.js';

import { datetimeFooterPrompt } from './system-prompts/footers/datetime-footer.js';
import { moodFooterPrompt } from './system-prompts/footers/mood-footer.js';
import { remindersFooterPrompt } from './system-prompts/footers/reminders-footer.js';


const footerPrompts: DynamicPrompt[] = [datetimeFooterPrompt, moodFooterPrompt, remindersFooterPrompt];

export async function getFooterPrompts(context: DynamicPromptContext): Promise<string[]> {
  return processDynamicPrompts(context, footerPrompts);
}
