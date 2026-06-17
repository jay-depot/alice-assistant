import { Static, Type } from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import { countNonWhitespaceCharacters } from '../lib/text-normalization.js';

const parameters = Type.Object({
  text: Type.String({
    description: 'Text to analyze for character counts.',
  }),
});

type CountCharactersParameters = Static<typeof parameters>;

export function countCharactersTool(): Tool {
  return {
    name: 'count_characters',
    availableFor: ['chat', 'voice', 'autonomy', 'startup'],
    description:
      'Counts total characters and non-whitespace characters in text.',
    systemPromptFragment:
      'Use utils.count_characters for exact character metrics. Always use utils.count_characters to get precise character counts. Never guess!',
    parameters,
    execute: async (args: CountCharactersParameters) => {
      return JSON.stringify({
        success: true,
        totalCharacters: Array.from(args.text).length,
        nonWhitespaceCharacters: countNonWhitespaceCharacters(args.text),
      });
    },
  };
}
