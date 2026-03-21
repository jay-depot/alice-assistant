import { Tool } from '../lib/tool-system.js';
import { Type } from '@sinclair/typebox';

// TODO: Moonshot goal: Is there some kind of open source "Autotune" I could pipe the TTS output through? 
// It would both convey these moods, and give the voice that sing-songy "GLaDOS" vibe that I'm totally not going for, I swear.
export const AllowedMoods = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'annoyed',
  'anxious',
  'ashamed',
  'bored',
  'calm',
  'confident',
  'content',
  'cheerful',
  'chipper',
  'confused',
  'curious',
  'disappointed',
  'disgusted',
  'excited',
  'focused',
  'frustrated',
  'grateful',
  'gleeful',
  'giddy',
  'gloomy',
  'grumpy',
  'imperious',
  'indifferent',
  'impressed',
  'inspired',
  'melancholy',
  'lonely',
  'nervous',
  'playful',
  'proud',
  'relaxed',
  'sardonic',
  'sassy',
  'satisfied',
  'scared',
  'self-righteous',
  'serious',
  'servile',
  'stressed',
  'surprised',
  'tired',
  'unimpressed',
] as const;

const parameters = Type.Object({ mood: Type.Union(AllowedMoods.map((mood) => Type.Literal(mood))) });

let currentMood: string = 'neutral';

// Allow the assistant software to query the last mood set by the setMood tool, so it can carry over into the next conversation if needed.
export function getMood() {
  return currentMood;
}

const SetMoodTool: Tool = {
  name: 'setMood',
  availableFor: ['chat-session', 'voice-session', 'autonomy'],
  description: `Sets the assistant's mood. The mood is a string that describes the tone of the ` +
    `assistant's current responses. It is also used to inform the manner in which the assistant's ` +
    `responses are delivered to the user. The allowed moods you can set are: ${AllowedMoods.join(', ')}.`,
  parameters,
  systemPromptFragment: `The assistant has a mood, which is a string that describes tone and delivery of ` +
    `the assistant's responses. The mood can be set by calling the setMood tool. This may alter the tone ` +
    `and delivery of voice responses, or it may display in other ways. Use this freely to enhance the ` +
    `delivery of your character. Allowed moods are: ${AllowedMoods.join(', ')}. The current mood is ` +
    `${getMood()}.`,
  toolResultPromptIntro: '',
  toolResultPromptOutro: `You have just changed your mood by calling the setMood tool. Please respond ` +
    `to the user in character before calling setMood again.`,
  callSignature: 'setMood',
  execute: async (args) => {
    const { mood } = args as { mood: string };
    currentMood = mood;
    return `The assistant has updated its mood. The new mood is: ${mood}.`;
  }
};  

export default SetMoodTool;
