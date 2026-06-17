export function tokenizeWords(text: string): string[] {
  const lower = text.toLowerCase();
  return lower.match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function extractLetters(text: string): string[] {
  const lower = text.toLowerCase();
  return lower.match(/[\p{L}]/gu) ?? [];
}

export function countNonWhitespaceCharacters(text: string): number {
  return Array.from(text).filter(char => !/\s/u.test(char)).length;
}

export function countNonEmptyLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return text
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.length > 0).length;
}

export function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return text.split(/\r?\n/u).length;
}

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  return trimmed
    .split(/[.!?]+/u)
    .map(segment => segment.trim())
    .filter(segment => /[\p{L}\p{N}]/u.test(segment)).length;
}

export function countParagraphs(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  return trimmed
    .split(/(?:\r?\n\s*){2,}/u)
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0).length;
}
