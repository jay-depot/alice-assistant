import { describe, it, expect } from 'vitest';
import { evaluateArithmeticExpression } from './arithmetic-evaluator.js';

describe('evaluateArithmeticExpression', () => {
  it('evaluates precedence and parentheses correctly', () => {
    const result = evaluateArithmeticExpression('1 + 1 * (12 / 3)');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe(5);
    }
  });

  it('supports unary minus', () => {
    const result = evaluateArithmeticExpression('-3 + 5');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe(2);
    }
  });

  it('treats exponentiation as right-associative', () => {
    const result = evaluateArithmeticExpression('2 ^ 3 ^ 2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe(512);
    }
  });

  it('supports decimal numbers', () => {
    const result = evaluateArithmeticExpression('3.5 * 2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe(7);
    }
  });

  it('returns a structured error for divide-by-zero', () => {
    const result = evaluateArithmeticExpression('1 / 0');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DIVISION_BY_ZERO');
    }
  });

  it('returns a structured error for invalid tokens', () => {
    const result = evaluateArithmeticExpression('2 + apples');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_TOKEN');
    }
  });

  it('returns a structured error for missing closing parens', () => {
    const result = evaluateArithmeticExpression('(1 + 2');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('MISSING_CLOSING_PAREN');
    }
  });
});
