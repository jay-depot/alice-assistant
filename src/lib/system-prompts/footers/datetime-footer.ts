import { DynamicPrompt } from '../../dynamic-prompt.js';
import { UserConfig } from '../../user-config.js';

export const datetimeFooterPrompt: DynamicPrompt = {
  name: 'datetimeFooter',
  weight: 9999,
  getPrompt: async () => {
    const systemPromptChunks: string[] = [];
    systemPromptChunks.push(`## ADDITIONAL CONTEXT\n`);
    systemPromptChunks.push(`The current date and time are: ${new Date().toLocaleString()}`);
    systemPromptChunks.push(`The current day of the week is: ${new Date().toLocaleString('en-US', { weekday: 'long' })}`);
    systemPromptChunks.push(`The current location is: ${UserConfig.getConfig().location}`);
    return systemPromptChunks.join('\n');
  }
};
