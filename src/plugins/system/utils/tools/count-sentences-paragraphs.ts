import { Static, Type } from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import { countParagraphs, countSentences } from '../lib/text-normalization.js';

const parameters = Type.Object({
  text: Type.String({
    description: 'Text to analyze for sentence and paragraph counts.',
  }),
});

type CountSentencesParagraphsParameters = Static<typeof parameters>;

export function countSentencesParagraphsTool(): Tool {
  return {
    name: 'count_sentences_paragraphs',
    availableFor: ['chat', 'voice', 'autonomy', 'startup'],
    description:
      'Counts sentences and paragraphs using deterministic heuristics.',
    systemPromptFragment:
      'Use utils.count_sentences_paragraphs for exact heuristic sentence/paragraph counts. Always use utils.count_sentences_paragraphs to get precise counts of sentences and paragraphs based on standard heuristics. Never guess!',
    parameters,
    execute: async (args: CountSentencesParagraphsParameters) => {
      return JSON.stringify({
        success: true,
        sentenceCount: countSentences(args.text),
        paragraphCount: countParagraphs(args.text),
      });
    },
  };
}
