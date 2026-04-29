import { describe, it, expect } from 'vitest';
import { checkLLMResponseForDegeneracy } from './degeneracy-check.js';

describe('checkLLMResponseForDegeneracy', () => {
  it('does not throw for a normal response', () => {
    expect(() =>
      checkLLMResponseForDegeneracy('Hello! How can I help you today?')
    ).not.toThrow();
  });

  it('does not throw for an empty response', () => {
    expect(() => checkLLMResponseForDegeneracy('')).not.toThrow();
  });

  it('throws on 21+ consecutive repetitions of the same word', () => {
    const repeated = Array(22).fill('yes').join(' ');
    expect(() => checkLLMResponseForDegeneracy(repeated)).toThrow('degenerate');
  });

  it('does not throw for 20 or fewer repetitions', () => {
    const repeated = Array(20).fill('yes').join(' ');
    expect(() => checkLLMResponseForDegeneracy(repeated)).not.toThrow();
  });

  it('throws on a tool-call dumped as garbage unicode + JSON', () => {
    // Simulate the pattern: TOOLNAME + garbage unicode chars + {JSON}
    const garbageResponse = 'myTool\u0001\u0002{"arg":"value"}';
    expect(() => checkLLMResponseForDegeneracy(garbageResponse)).toThrow(
      'degenerate'
    );
  });
});
