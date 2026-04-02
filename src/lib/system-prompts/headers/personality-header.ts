import { UserConfig } from '../../user-config.js';
import { DynamicPrompt } from '../../dynamic-prompt.js';

export const personalityHeaderPrompt: DynamicPrompt = {
  name: 'personalityHeader',
  weight: -9999,
  getPrompt: async (context) => {
    return await buildPersonalityPrompt();
  }
};

async function buildPersonalityPrompt() {
  const systemPromptChunks: string[] = [];
  // First the heading
  systemPromptChunks.push(`# PC DIGITAL ASSISTANT PERSONALITY AND SYSTEM INFO\n`);
  // Then the intro
  systemPromptChunks.push('## INTRODUCTION\n');
  systemPromptChunks.push(UserConfig.getConfig().personality.INTRO);
  // Then the quirks
  systemPromptChunks.push(`\n## PERSONALITY QUIRKS\n`);
  systemPromptChunks.push(UserConfig.getConfig().personality.QUIRKS);
  // Then any "other" personality files the user has added, each under its own heading.
  Object.keys(UserConfig.getConfig().personality).
    filter((key: string) => key !== 'INTRO' && key !== 'QUIRKS').
    forEach((key: string) => {
      const value = UserConfig.getConfig().personality[key];
      systemPromptChunks.push(`## ${key}\n\n${value}\n`);
    });

  return systemPromptChunks.join('\n');
}
