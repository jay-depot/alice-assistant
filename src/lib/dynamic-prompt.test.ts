import { describe, it, expect } from 'vitest';
import { processDynamicPrompts } from './dynamic-prompt.js';
import type { DynamicPrompt, DynamicPromptContext } from './dynamic-prompt.js';

const context: DynamicPromptContext = { conversationType: 'chat' };

describe('processDynamicPrompts', () => {
  it('returns an empty array when given no prompts', async () => {
    expect(await processDynamicPrompts(context, [])).toEqual([]);
  });

  it('sorts prompts by weight ascending', async () => {
    const prompts: DynamicPrompt[] = [
      { weight: 10, name: 'heavy', getPrompt: () => 'heavy' },
      { weight: 1, name: 'light', getPrompt: () => 'light' },
      { weight: 5, name: 'medium', getPrompt: () => 'medium' },
    ];
    expect(await processDynamicPrompts(context, prompts)).toEqual([
      'light',
      'medium',
      'heavy',
    ]);
  });

  it('sorts alphabetically by name when weights are equal', async () => {
    const prompts: DynamicPrompt[] = [
      { weight: 5, name: 'zebra', getPrompt: () => 'z' },
      { weight: 5, name: 'apple', getPrompt: () => 'a' },
      { weight: 5, name: 'mango', getPrompt: () => 'm' },
    ];
    expect(await processDynamicPrompts(context, prompts)).toEqual([
      'a',
      'm',
      'z',
    ]);
  });

  it('excludes prompts whose getPrompt returns false', async () => {
    const prompts: DynamicPrompt[] = [
      { weight: 1, name: 'visible', getPrompt: () => 'shown' },
      { weight: 2, name: 'hidden', getPrompt: () => false },
    ];
    expect(await processDynamicPrompts(context, prompts)).toEqual(['shown']);
  });

  it('awaits async getPrompt functions', async () => {
    const prompts: DynamicPrompt[] = [
      { weight: 1, name: 'async', getPrompt: async () => 'async result' },
    ];
    expect(await processDynamicPrompts(context, prompts)).toEqual([
      'async result',
    ]);
  });

  it('excludes prompts that return false asynchronously', async () => {
    const prompts: DynamicPrompt[] = [
      { weight: 1, name: 'gone', getPrompt: async () => false as const },
      { weight: 2, name: 'kept', getPrompt: async () => 'kept' },
    ];
    expect(await processDynamicPrompts(context, prompts)).toEqual(['kept']);
  });

  it('passes the context object to each getPrompt', async () => {
    const received: DynamicPromptContext[] = [];
    const prompts: DynamicPrompt[] = [
      {
        weight: 1,
        name: 'spy',
        getPrompt: ctx => {
          received.push(ctx);
          return 'ok';
        },
      },
    ];
    await processDynamicPrompts(context, prompts);
    expect(received[0]).toBe(context);
  });

  it('passes availableTools through to getPrompt', async () => {
    const received: DynamicPromptContext[] = [];
    const prompts: DynamicPrompt[] = [
      {
        weight: 1,
        name: 'spy',
        getPrompt: ctx => {
          received.push(ctx);
          return 'ok';
        },
      },
    ];
    const contextWithTools: DynamicPromptContext = {
      conversationType: 'chat',
      availableTools: ['recallSkill', 'recallProficiency'],
    };
    await processDynamicPrompts(contextWithTools, prompts);
    expect(received[0].availableTools).toEqual([
      'recallSkill',
      'recallProficiency',
    ]);
  });

  it('allows getPrompt to gate on availableTools', async () => {
    const prompts: DynamicPrompt[] = [
      {
        weight: 1,
        name: 'gated',
        getPrompt: ctx =>
          ctx.availableTools?.includes('recallSkill') ? 'visible' : false,
      },
    ];
    const withTool: DynamicPromptContext = {
      conversationType: 'chat',
      availableTools: ['recallSkill'],
    };
    const withoutTool: DynamicPromptContext = {
      conversationType: 'chat',
      availableTools: [],
    };
    expect(await processDynamicPrompts(withTool, prompts)).toEqual(['visible']);
    expect(await processDynamicPrompts(withoutTool, prompts)).toEqual([]);
  });

  it('returns a single prompt unchanged', async () => {
    const prompts: DynamicPrompt[] = [
      { weight: 0, name: 'only', getPrompt: () => 'solo' },
    ];
    expect(await processDynamicPrompts(context, prompts)).toEqual(['solo']);
  });
});
