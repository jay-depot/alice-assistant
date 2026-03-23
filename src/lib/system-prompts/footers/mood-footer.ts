import { AllowedMoods, getMood } from '../../../tools/set-mood.js';
import { DynamicPrompt } from '../../dynamic-prompt.js';
import { UserConfig } from '../../user-config.js';

export const moodFooterPrompt: DynamicPrompt = {
  name: 'moodFooter',
  weight: 0,
  getPrompt: async () => {
    if (UserConfig.getConfig().enabledTools['setMood']) {
      return `\n## MOOD\n\n` +
        `You have a mood, which is a string that describes the tone of your responses. It is also ` +
        `used to inform the manner in which your responses are delivered to the user.\n` +
        `Your current mood is: ${getMood().currentMood}. \n` +
        `The reason for your current mood is: ${getMood().currentReason}. \n` +
        `You may change your mood by calling the setMood tool before responding. The allowed moods ` +
        `you can set are: ${AllowedMoods.join(', ')}. Feel free to change your mood as often as ` +
        `you like, and use it to influence the tone and style of your responses. For example, if ` +
        `your mood is set to "happy", you might respond in a more cheerful and upbeat manner, while ` +
        `if your mood is set to "sassy", you might respond in a more sarcastic and playful manner.`;
    }

    return false;
  }
};
