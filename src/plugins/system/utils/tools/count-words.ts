import { Static, Type } from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import { tokenizeWords } from '../lib/text-normalization.js';

const parameters = Type.Object({
  text: Type.String({
    description: 'Text to analyze for word count.',
  }),
});

type CountWordsParameters = Static<typeof parameters>;

export function countWordsTool(): Tool {
  return {
    name: 'count_words',
    availableFor: ['chat', 'voice', 'autonomy', 'startup'],
    description:
      'Counts words in text using case-insensitive normalization and punctuation-ignoring tokenization.',
    systemPromptFragment:
      'Use utils.count_words when the user asks for an exact word count instead of estimated counting. Always use utils.count_words to get precise word counts. Never guess!',
    parameters,
    execute: async (args: CountWordsParameters) => {
      const words = tokenizeWords(args.text);

      return JSON.stringify({
        success: true,
        totalWords: words.length,
      });
    },
  };
}
