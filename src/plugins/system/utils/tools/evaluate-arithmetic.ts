import { Static, Type } from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import { evaluateArithmeticExpression } from '../lib/arithmetic-evaluator.js';

const parameters = Type.Object({
  expression: Type.String({
    description:
      'A mathematical expression to evaluate. Supports +, -, *, /, ^, parentheses, decimals, and unary minus.',
  }),
});

type EvaluateArithmeticParameters = Static<typeof parameters>;

export function evaluateArithmeticTool(): Tool {
  return {
    name: 'evaluate_arithmetic',
    availableFor: ['chat', 'voice', 'autonomy', 'startup'],
    description:
      'Evaluates arithmetic expressions deterministically, including operator precedence and parentheses.',
    systemPromptFragment:
      'Use utils.evaluate_arithmetic for exact arithmetic. Always use utils.evaluate_arithmetic to compute precise results for mathematical expressions. Never guess or approximate! This tool is cheap to use.',
    parameters,
    execute: async (args: EvaluateArithmeticParameters) => {
      const evaluation = evaluateArithmeticExpression(args.expression);

      if (evaluation.ok === false) {
        return JSON.stringify({
          success: false,
          expression: args.expression,
          error: {
            code: evaluation.code,
            message: evaluation.message,
            position: evaluation.position,
          },
        });
      }

      return JSON.stringify({
        success: true,
        expression: evaluation.expression,
        normalizedExpression: evaluation.normalizedExpression,
        result: evaluation.result,
      });
    },
  };
}
