import { Tool } from '@lib/tool-system';
import { Type } from '@sinclair/typebox';

const parameters = Type.Object({
  mood: Type.Union([
    Type.Literal('happy'),
    Type.Literal('sad'),
    Type.Literal('angry'),
    Type.Literal('anxious'),
    Type.Literal('excited'),
    Type.Literal('bored'),
    Type.Literal('confused'),
    Type.Literal('curious'),
    Type.Literal('frustrated'),
    Type.Literal('grateful'),
    Type.Literal('lonely'),
    Type.Literal('nervous'),
    Type.Literal('proud'),
    Type.Literal('relaxed'),
    Type.Literal('scared'),
    Type.Literal('stressed'),
    Type.Literal('surprised'),
    Type.Literal('tired'),
    Type.Literal('neutral'),
  ])
});

export const SetMoodTool: Tool = {
  name: 'set_mood',
  description: 'Sets the assistant\'s mood. The mood is a string that describes the assistant\'s current emotional state, and can be used to influence the tone and style of the assistant\'s responses. For example, if the mood is set to "happy", the assistant might respond in a more cheerful and upbeat manner, while if the mood is set to "sad", the assistant might respond in a more somber and empathetic manner.',
  parameters,
  systemPromptFragment: 'The assistant has a mood, which is a string that describes the assistant\'s current emotional state. The mood can be set by calling the set_mood tool, and can be used to influence the tone and style of the assistant\'s responses. For example, if the mood is set to "happy", the assistant might respond in a more cheerful and upbeat manner, while if the mood is set to "sad", the assistant might respond in a more somber and empathetic manner.',
  toolResultPromptIntro: 'The assistant\'s mood has been updated. The new mood is:',
  toolResultPromptOutro: 'Use this information to inform the tone and style of your responses in the rest of this conversation.',
  callSignature: 'set_mood',
  execute: async (args) => {
    const { mood } = args as { mood: string };
    // Here we would actually set the mood in the assistant's state, but for now we'll just return a confirmation message.
    return `Assistant mood set to ${mood}.`;
  }
};  
