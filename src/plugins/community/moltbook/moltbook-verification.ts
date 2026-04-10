type VerificationResult = {
  success: true;
  answer: string;
} | {
  success: false;
  error: string;
};

const canonicalNumbers: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

const operationKeywords = {
  add: ['add', 'plus', 'gain', 'gains', 'gained', 'increases', 'increase', 'faster', 'more'],
  subtract: ['subtract', 'minus', 'lose', 'loses', 'lost', 'slows', 'slower', 'decrease', 'decreases', 'drops', 'drop', 'less'],
  multiply: ['times', 'multiply', 'multiplies', 'doubles', 'double', 'triples', 'triple'],
  divide: ['divide', 'divides', 'divided', 'split', 'splits', 'per', 'each'],
};

function editDistance(left: string, right: string) {
  const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= right.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[left.length][right.length];
}

function canonicalizeWord(word: string) {
  const lower = word.toLowerCase();
  if (canonicalNumbers[lower] !== undefined) {
    return lower;
  }

  let bestMatch = lower;
  let bestDistance = Number.POSITIVE_INFINITY;
  Object.keys(canonicalNumbers).forEach((candidate) => {
    const distance = editDistance(lower, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  });

  return bestDistance <= 2 ? bestMatch : lower;
}

function normalizeChallenge(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(canonicalizeWord);
}

function parseNumbers(tokens: string[]) {
  const numbers: number[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^-?\d+(?:\.\d+)?$/.test(token)) {
      numbers.push(Number(token));
      continue;
    }

    if (canonicalNumbers[token] === undefined) {
      continue;
    }

    let value = 0;
    let used = false;
    while (index < tokens.length) {
      const current = tokens[index];
      const currentValue = canonicalNumbers[current];
      if (currentValue === undefined) {
        break;
      }

      used = true;
      if (current === 'hundred') {
        value = value === 0 ? 100 : value * 100;
      } else if (currentValue >= 20) {
        value += currentValue;
      } else {
        value += currentValue;
      }

      index += 1;
    }

    if (used) {
      numbers.push(value);
      index -= 1;
    }
  }

  return numbers;
}

function parseOperation(tokens: string[]) {
  if (tokens.some((token) => operationKeywords.multiply.includes(token))) {
    return '*';
  }
  if (tokens.some((token) => operationKeywords.divide.includes(token))) {
    return '/';
  }
  if (tokens.some((token) => operationKeywords.subtract.includes(token))) {
    return '-';
  }
  if (tokens.some((token) => operationKeywords.add.includes(token))) {
    return '+';
  }
  return undefined;
}

export function solveMoltbookVerificationChallenge(challengeText: string): VerificationResult {
  const tokens = normalizeChallenge(challengeText);
  const numbers = parseNumbers(tokens);
  const operation = parseOperation(tokens);

  if (numbers.length < 2 || !operation) {
    return {
      success: false,
      error: 'Could not parse the numbers and operation from the Moltbook challenge.',
    };
  }

  const [left, right] = numbers;
  let answer: number;
  switch (operation) {
    case '+':
      answer = left + right;
      break;
    case '-':
      answer = left - right;
      break;
    case '*':
      answer = left * right;
      break;
    case '/':
      if (right === 0) {
        return {
          success: false,
          error: 'Refusing to solve a divide-by-zero Moltbook challenge.',
        };
      }
      answer = left / right;
      break;
    default:
      return {
        success: false,
        error: 'Unsupported Moltbook verification operation.',
      };
  }

  return {
    success: true,
    answer: answer.toFixed(2),
  };
}