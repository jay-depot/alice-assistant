import { Static, Type } from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import { extractLetters } from '../lib/text-normalization.js';

const parameters = Type.Object({
  text: Type.String({
    description: 'Text to analyze for letter frequency.',
  }),
});

type CountLettersParameters = Static<typeof parameters>;

type LetterFrequency = {
  letter: string;
  count: number;
};

export function countLettersTool(): Tool {
  return {
    name: 'count_letters',
    availableFor: ['chat', 'voice', 'autonomy', 'startup'],
    description:
      'Counts letters in text and returns a structured frequency list and map.',
    systemPromptFragment:
      'Use utils.count_letters when exact per-letter frequencies are needed. Always use utils.count_letters for precise letter counts and frequencies. Never guess!',
    parameters,
    execute: async (args: CountLettersParameters) => {
      const letters = extractLetters(args.text);
      const counts: Record<string, number> = {};

      for (const letter of letters) {
        counts[letter] = (counts[letter] ?? 0) + 1;
      }

      const frequencies: LetterFrequency[] = Object.keys(counts)
        .sort((a, b) => a.localeCompare(b))
        .map(letter => ({
          letter,
          count: counts[letter],
        }));

      return JSON.stringify({
        success: true,
        totalLetters: letters.length,
        distinctLetters: frequencies.length,
        frequencies,
        counts,
      });
    },
  };
}
