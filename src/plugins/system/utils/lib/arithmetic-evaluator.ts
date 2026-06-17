type NumberToken = {
  type: 'number';
  value: number;
  text: string;
  position: number;
};

type OperatorToken = {
  type: 'operator';
  value: '+' | '-' | '*' | '/' | '^';
  position: number;
};

type ParenToken = {
  type: 'lparen' | 'rparen';
  position: number;
};

type Token = NumberToken | OperatorToken | ParenToken;

export type ArithmeticEvaluationErrorCode =
  | 'EMPTY_EXPRESSION'
  | 'INVALID_TOKEN'
  | 'INVALID_NUMBER'
  | 'UNEXPECTED_TOKEN'
  | 'MISSING_CLOSING_PAREN'
  | 'DIVISION_BY_ZERO'
  | 'NON_FINITE_RESULT';

export type ArithmeticEvaluationError = {
  ok: false;
  code: ArithmeticEvaluationErrorCode;
  message: string;
  position?: number;
};

export type ArithmeticEvaluationSuccess = {
  ok: true;
  expression: string;
  normalizedExpression: string;
  result: number;
};

export type ArithmeticEvaluationResult =
  | ArithmeticEvaluationSuccess
  | ArithmeticEvaluationError;

function makeError(
  code: ArithmeticEvaluationErrorCode,
  message: string,
  position?: number
): ArithmeticEvaluationError {
  return { ok: false, code, message, position };
}

function tokenize(
  expression: string
):
  | { ok: true; tokens: Token[] }
  | { ok: false; error: ArithmeticEvaluationError } {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'lparen', position: i });
      i += 1;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: 'rparen', position: i });
      i += 1;
      continue;
    }

    if (
      char === '+' ||
      char === '-' ||
      char === '*' ||
      char === '/' ||
      char === '^'
    ) {
      tokens.push({ type: 'operator', value: char, position: i });
      i += 1;
      continue;
    }

    if (/\d|\./.test(char)) {
      const start = i;
      let hasDot = false;
      let sawDigit = false;

      while (i < expression.length) {
        const inner = expression[i];
        if (/\d/.test(inner)) {
          sawDigit = true;
          i += 1;
          continue;
        }

        if (inner === '.') {
          if (hasDot) {
            return {
              ok: false,
              error: makeError(
                'INVALID_NUMBER',
                'Invalid number literal with multiple decimal points.',
                i
              ),
            };
          }
          hasDot = true;
          i += 1;
          continue;
        }

        break;
      }

      if (!sawDigit) {
        return {
          ok: false,
          error: makeError('INVALID_NUMBER', 'Invalid number literal.', start),
        };
      }

      const text = expression.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          error: makeError(
            'INVALID_NUMBER',
            'Number literal is not finite.',
            start
          ),
        };
      }

      tokens.push({ type: 'number', value, text, position: start });
      continue;
    }

    return {
      ok: false,
      error: makeError(
        'INVALID_TOKEN',
        `Invalid token "${char}" in expression.`,
        i
      ),
    };
  }

  if (tokens.length === 0) {
    return {
      ok: false,
      error: makeError('EMPTY_EXPRESSION', 'Expression is empty.'),
    };
  }

  return { ok: true, tokens };
}

class Parser {
  private readonly tokens: Token[];

  private cursor = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse():
    | { ok: true; value: number }
    | { ok: false; error: ArithmeticEvaluationError } {
    const valueResult = this.parseExpression();
    if (!valueResult.ok) {
      return valueResult;
    }

    const trailing = this.current();
    if (trailing) {
      return {
        ok: false,
        error: makeError(
          'UNEXPECTED_TOKEN',
          'Unexpected token after valid expression.',
          trailing.position
        ),
      };
    }

    if (!Number.isFinite(valueResult.value)) {
      return {
        ok: false,
        error: makeError(
          'NON_FINITE_RESULT',
          'Expression result is not finite.'
        ),
      };
    }

    return { ok: true, value: valueResult.value };
  }

  private parseExpression():
    | { ok: true; value: number }
    | { ok: false; error: ArithmeticEvaluationError } {
    let left = this.parseTerm();
    if (!left.ok) {
      return left;
    }

    while (true) {
      const token = this.current();
      if (!token || token.type !== 'operator') {
        break;
      }
      if (token.value !== '+' && token.value !== '-') {
        break;
      }

      this.advance();
      const right = this.parseTerm();
      if (!right.ok) {
        return right;
      }

      left = {
        ok: true,
        value:
          token.value === '+'
            ? left.value + right.value
            : left.value - right.value,
      };
    }

    return left;
  }

  private parseTerm():
    | { ok: true; value: number }
    | { ok: false; error: ArithmeticEvaluationError } {
    let left = this.parsePower();
    if (!left.ok) {
      return left;
    }

    while (true) {
      const token = this.current();
      if (!token || token.type !== 'operator') {
        break;
      }
      if (token.value !== '*' && token.value !== '/') {
        break;
      }

      this.advance();
      const right = this.parsePower();
      if (!right.ok) {
        return right;
      }

      if (token.value === '/') {
        if (right.value === 0) {
          return {
            ok: false,
            error: makeError(
              'DIVISION_BY_ZERO',
              'Division by zero is not allowed.',
              token.position
            ),
          };
        }

        left = { ok: true, value: left.value / right.value };
      } else {
        left = { ok: true, value: left.value * right.value };
      }
    }

    return left;
  }

  private parsePower():
    | { ok: true; value: number }
    | { ok: false; error: ArithmeticEvaluationError } {
    const left = this.parseUnary();
    if (!left.ok) {
      return left;
    }

    const token = this.current();
    if (!token || token.type !== 'operator' || token.value !== '^') {
      return left;
    }

    this.advance();
    const right = this.parsePower();
    if (!right.ok) {
      return right;
    }

    return { ok: true, value: left.value ** right.value };
  }

  private parseUnary():
    | { ok: true; value: number }
    | { ok: false; error: ArithmeticEvaluationError } {
    const token = this.current();
    if (token && token.type === 'operator' && token.value === '-') {
      this.advance();
      const inner = this.parseUnary();
      if (!inner.ok) {
        return inner;
      }
      return { ok: true, value: -inner.value };
    }

    return this.parsePrimary();
  }

  private parsePrimary():
    | { ok: true; value: number }
    | { ok: false; error: ArithmeticEvaluationError } {
    const token = this.current();
    if (!token) {
      return {
        ok: false,
        error: makeError('UNEXPECTED_TOKEN', 'Unexpected end of expression.'),
      };
    }

    if (token.type === 'number') {
      this.advance();
      return { ok: true, value: token.value };
    }

    if (token.type === 'lparen') {
      const openPosition = token.position;
      this.advance();
      const inner = this.parseExpression();
      if (!inner.ok) {
        return inner;
      }

      const close = this.current();
      if (!close || close.type !== 'rparen') {
        return {
          ok: false,
          error: makeError(
            'MISSING_CLOSING_PAREN',
            'Missing closing parenthesis.',
            openPosition
          ),
        };
      }

      this.advance();
      return inner;
    }

    return {
      ok: false,
      error: makeError(
        'UNEXPECTED_TOKEN',
        'Unexpected token in expression.',
        token.position
      ),
    };
  }

  private current(): Token | undefined {
    return this.tokens[this.cursor];
  }

  private advance(): void {
    this.cursor += 1;
  }
}

function buildNormalizedExpression(tokens: Token[]): string {
  return tokens
    .map(token => {
      if (token.type === 'number') {
        return token.text;
      }
      if (token.type === 'operator') {
        return token.value;
      }
      return token.type === 'lparen' ? '(' : ')';
    })
    .join(' ');
}

export function evaluateArithmeticExpression(
  expression: string
): ArithmeticEvaluationResult {
  const tokenized = tokenize(expression);
  if (tokenized.ok === false) {
    return tokenized.error;
  }

  const parser = new Parser(tokenized.tokens);
  const parsed = parser.parse();
  if (parsed.ok === false) {
    return parsed.error;
  }

  return {
    ok: true,
    expression,
    normalizedExpression: buildNormalizedExpression(tokenized.tokens),
    result: parsed.value,
  };
}
