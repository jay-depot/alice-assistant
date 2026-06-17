import { Static, Type } from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';

const parameters = Type.Object({
  word: Type.String({
    description:
      'String to spell out as an array of characters. Input is preserved as-is, including spaces and punctuation.',
  }),
});

type SpellParameters = Static<typeof parameters>;

export function spellTool(): Tool {
  return {
    name: 'spell',
    availableFor: ['chat', 'voice', 'autonomy', 'startup'],
    description:
      'Returns a JSON array of characters for the given input string, preserving case and whitespace.',
    systemPromptFragment:
      'Use utils.spell when you need the exact character-by-character spelling of an input string.',
    parameters,
    execute: async (args: SpellParameters) => {
      return JSON.stringify(Array.from(args.word));
    },
  };
}
