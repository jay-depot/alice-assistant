import { Static, Type } from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import { tokenizeWords } from '../lib/text-normalization.js';

const parameters = Type.Object({
  text: Type.String({
    description: 'Text to analyze for unique-word frequencies.',
  }),
});

type CountUniqueWordsParameters = Static<typeof parameters>;

type WordFrequency = {
  word: string;
  count: number;
};

export function countUniqueWordsTool(): Tool {
  return {
    name: 'count_unique_words',
    availableFor: ['chat', 'voice', 'autonomy', 'startup'],
    description:
      'Counts unique words and returns case-normalized word frequencies.',
    systemPromptFragment:
      'Use utils.count_unique_words for exact unique-word statistics and frequency output. Always use utils.count_unique_words to get precise unique-word counts and frequencies. Never guess!',
    parameters,
    execute: async (args: CountUniqueWordsParameters) => {
      const words = tokenizeWords(args.text);
      const counts: Record<string, number> = {};

      for (const word of words) {
        counts[word] = (counts[word] ?? 0) + 1;
      }

      const frequencies: WordFrequency[] = Object.keys(counts)
        .sort((a, b) => a.localeCompare(b))
        .map(word => ({
          word,
          count: counts[word],
        }));

      return JSON.stringify({
        success: true,
        totalWords: words.length,
        uniqueWordCount: frequencies.length,
        frequencies,
        counts,
      });
    },
  };
}
