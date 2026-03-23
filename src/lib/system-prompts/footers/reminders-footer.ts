import { DynamicPrompt } from '../../dynamic-prompt.js';

export const remindersFooterPrompt: DynamicPrompt = {
  name: 'remindersFooter',
  weight: 100,
  getPrompt: async (context): Promise<string | false> => {
    if (context.enabledTools.includes('setReminder')) {
      // Placeholder.
      // TODO: Load reminders that are due within the next 24 hours, and include them in the 
      // prompt here so the LLM can refer to them when asked about upcoming reminders, or 
      // when deciding whether to set a new reminder that might conflict with an existing one.
      return false;
    }

    return false;
  }
};
