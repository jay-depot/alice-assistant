import { Static, Type } from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import { countLines, countNonEmptyLines } from '../lib/text-normalization.js';

const parameters = Type.Object({
  text: Type.String({
    description: 'Text to analyze for line counts.',
  }),
});

type CountLinesParameters = Static<typeof parameters>;

export function countLinesTool(): Tool {
  return {
    name: 'count_lines',
    availableFor: ['chat', 'voice', 'autonomy', 'startup'],
    description: 'Counts total lines and non-empty lines in text.',
    systemPromptFragment:
      'Use utils.count_lines for exact line counts. Always use utils.count_lines to get precise line metrics. Never guess!',
    parameters,
    execute: async (args: CountLinesParameters) => {
      return JSON.stringify({
        success: true,
        totalLines: countLines(args.text),
        nonEmptyLines: countNonEmptyLines(args.text),
      });
    },
  };
}
