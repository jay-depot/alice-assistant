import { describe, it, expect, vi } from 'vitest';

vi.mock('../header-prompts.js', () => ({
  getHeaderPrompts: vi
    .fn()
    .mockResolvedValue(['# Header prompt 1', '# Header prompt 2']),
  addHeaderPrompt: vi.fn(),
}));

vi.mock('../footer-prompts.js', () => ({
  getFooterPrompts: vi.fn().mockResolvedValue(['# Footer prompt']),
  addFooterPrompt: vi.fn(),
}));

import {
  assembleFullContext,
  type PromptAssemblerContext,
} from './prompt-assembler.js';

// We test the structural contract: that header prompts come first,
// then compactedContext, then footer prompts, all with the correct role.

describe('assembleFullContext', () => {
  const baseCtx: PromptAssemblerContext = {
    conversationType: 'chat',
    sessionId: 1,
    taskAssistantId: undefined,
    toolCallsAllowed: true,
    availableTools: ['testTool'],
  };

  it('returns an array of messages with role and content', async () => {
    const result = await assembleFullContext(baseCtx, []);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    for (const msg of result) {
      expect(msg).toHaveProperty('role');
      expect(msg).toHaveProperty('content');
      expect(typeof msg.content).toBe('string');
    }
  });

  it('places header prompts first, then compacted context, then footer prompts', async () => {
    const compacted = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ];

    const result = await assembleFullContext(baseCtx, compacted);

    // Header prompts are merged into a single system message with section dividers
    expect(result[0].content).toBe('# Header prompt 1\n\n---\n\n# Header prompt 2');

    // Then the compacted context
    expect(result[1].content).toBe('Hello');
    expect(result[2].content).toBe('Hi!');

    // Then the footer prompt
    expect(result[3].content).toBe('# Footer prompt');

    // Total: 1 merged header + 2 compacted + 1 footer = 4
    expect(result.length).toBe(4);
  });

  it('returns only prompts when compactedContext is empty', async () => {
    const result = await assembleFullContext(baseCtx, []);

    expect(result.length).toBe(2); // 1 merged header + 1 footer
    expect(result[0].content).toBe('# Header prompt 1\n\n---\n\n# Header prompt 2');
    expect(result[1].content).toBe('# Footer prompt');
  });
});
