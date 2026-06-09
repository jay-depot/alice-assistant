import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../plugin-hooks.js', () => ({
  PluginHooks: vi.fn(() => ({})),
  PluginHookInvocations: {
    invokeOnContextCompactionSummariesWillBeDeleted: vi
      .fn()
      .mockResolvedValue(undefined),
    invokeOnUserConversationWillBegin: vi.fn().mockResolvedValue(undefined),
    invokeOnUserConversationWillEnd: vi.fn().mockResolvedValue(undefined),
  },
}));

import { ConversationContextManager } from './context-manager.js';
import type { IConversationHost, SummarizerFn } from './context-manager.js';
import { SUMMARY_PROMPT } from './degeneracy-check.js';

function makeHost(
  overrides: Partial<IConversationHost> = {}
): IConversationHost {
  return {
    rawContext: [],
    compactedContext: [],
    type: 'chat',
    ...overrides,
  };
}

function makeSummarizer(summary = 'summary text'): SummarizerFn {
  return vi.fn().mockResolvedValue(summary);
}

describe('ConversationContextManager', () => {
  let host: IConversationHost;
  let summarizer: SummarizerFn;
  let mgr: ConversationContextManager;
  const approximateContextWindow = 4096;

  beforeEach(async () => {
    vi.clearAllMocks();
    host = makeHost();
    summarizer = makeSummarizer();
    mgr = new ConversationContextManager(
      host,
      approximateContextWindow,
      summarizer
    );
  });

  // ── restoreContext ─────────────────────────────────────────────────

  it('restoreContext sets rawContext and compactedContext', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    mgr.restoreContext(messages);
    expect(host.rawContext).toEqual(messages);
    expect(host.compactedContext).toEqual(messages);
  });

  it('restoreContext sets compactedContext separately when provided', () => {
    const raw = [{ role: 'user', content: 'raw' }];
    const compacted = [{ role: 'system', content: '# Summary\nstuff' }];
    mgr.restoreContext(raw, compacted);
    expect(host.rawContext).toEqual(raw);
    expect(host.compactedContext).toEqual(compacted);
  });

  it('restoreContext throws if called a second time', () => {
    mgr.restoreContext([{ role: 'user', content: 'first' }]);
    expect(() =>
      mgr.restoreContext([{ role: 'user', content: 'second' }])
    ).toThrow();
  });

  // ── unsynchronized message tracking ────────────────────────────────

  it('getUnsynchronizedMessages returns new messages only', () => {
    mgr.restoreContext([{ role: 'user', content: 'old' }]);
    // After restore, everything is synchronized
    expect(mgr.getUnsynchronizedMessages()).toEqual([]);
  });

  it('markUnsynchronizedMessagesSynchronized advances the pointer', () => {
    host.rawContext = [];
    host.compactedContext = [];
    // Manually set state without restore
    mgr = new ConversationContextManager(
      host,
      approximateContextWindow,
      summarizer
    );
    host.rawContext.push({ role: 'user', content: 'new' });
    expect(mgr.getUnsynchronizedMessages()).toHaveLength(1);
    mgr.markUnsynchronizedMessagesSynchronized();
    expect(mgr.getUnsynchronizedMessages()).toHaveLength(0);
  });

  // ── compactContext('normal') — small context, no compaction ────────

  it('compactContext("normal") returns false when context is small', async () => {
    mgr.restoreContext([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]);
    const result = await mgr.compactContext('normal');
    expect(result).toBe(false);
  });

  it('compactContext("normal") triggers summarizer when context is large', async () => {
    // approximateContextWindow is 4096, threshold is 1024 words.
    // Create a lot of words to trigger compaction.
    const bigMsg = {
      role: 'user' as const,
      content: Array(600).fill('word').join(' '),
    };
    mgr.restoreContext([bigMsg, bigMsg]);
    // 1200 words > 1024 threshold — should compact

    const result = await mgr.compactContext('normal');
    expect(result).toBe(true);
    expect(summarizer).toHaveBeenCalled();
  });

  // ── compactContext('full') ─────────────────────────────────────────

  it('compactContext("full") summarizes all non-summary messages', async () => {
    mgr.restoreContext([
      { role: 'user', content: 'Tell me about cats.' },
      { role: 'assistant', content: 'Cats are wonderful pets.' },
    ]);

    const result = await mgr.compactContext('full');
    expect(result).toBe(true);
    expect(summarizer).toHaveBeenCalled();
    const summaryRequest = vi.mocked(summarizer).mock.calls[0]?.[0];
    expect(summaryRequest).toHaveLength(1);
    expect(summaryRequest?.[0].role).toBe('system');
    expect(summaryRequest?.[0].content).toContain(SUMMARY_PROMPT);
    expect(summaryRequest?.[0].content).toContain('USER: Tell me about cats.');
    expect(summaryRequest?.[0].content).toContain(
      'ASSISTANT: Cats are wonderful pets.'
    );
    expect(host.compactedContext).toHaveLength(1);
    expect(host.compactedContext[0].content).toContain('summary text');
  });

  it('compactContext("full") returns false when everything is already summaries', async () => {
    host.compactedContext = [
      {
        role: 'system',
        content:
          '# Summary of earlier conversation:\n \n1/1/2026\n\nAlready summarized.',
      },
    ];
    host.rawContext = [...host.compactedContext];
    mgr = new ConversationContextManager(
      host,
      approximateContextWindow,
      summarizer
    );

    const result = await mgr.compactContext('full');
    expect(result).toBe(false);
  });

  // ── compactContext('clear') ────────────────────────────────────────

  it('compactContext("clear") evicts all summaries to memory hook', async () => {
    mgr.restoreContext([
      { role: 'user', content: 'Important question.' },
      { role: 'assistant', content: 'Important answer.' },
    ]);

    const { PluginHookInvocations } = await import('../plugin-hooks.js');

    const result = await mgr.compactContext('clear');
    expect(result).toBe(true);
    const summaryRequest = vi.mocked(summarizer).mock.calls[0]?.[0];
    expect(summaryRequest).toHaveLength(1);
    expect(summaryRequest?.[0].role).toBe('system');
    expect(summaryRequest?.[0].content).toContain(SUMMARY_PROMPT);
    expect(summaryRequest?.[0].content).toContain('USER: Important question.');
    expect(summaryRequest?.[0].content).toContain(
      'ASSISTANT: Important answer.'
    );
    expect(host.compactedContext).toHaveLength(0);
    expect(
      PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted
    ).toHaveBeenCalled();
  });

  // ── closeConversation ──────────────────────────────────────────────

  it('closeConversation summarizes remaining messages and fires hook', async () => {
    mgr.restoreContext([
      { role: 'user', content: 'Last question.' },
      { role: 'assistant', content: 'Last answer.' },
    ]);

    const { PluginHookInvocations } = await import('../plugin-hooks.js');

    await mgr.closeConversation();

    expect(summarizer).toHaveBeenCalled();
    const summaryRequest = vi.mocked(summarizer).mock.calls[0]?.[0];
    expect(summaryRequest).toHaveLength(1);
    expect(summaryRequest?.[0].role).toBe('system');
    expect(summaryRequest?.[0].content).toContain(SUMMARY_PROMPT);
    expect(summaryRequest?.[0].content).toContain('USER: Last question.');
    expect(summaryRequest?.[0].content).toContain('ASSISTANT: Last answer.');
    expect(
      PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted
    ).toHaveBeenCalled();
  });

  // ── appendToContext ────────────────────────────────────────────────

  it('appendToContext pushes to both raw and compacted context', async () => {
    mgr.restoreContext([{ role: 'user', content: 'existing' }]);
    const beforeRaw = host.rawContext.length;
    const beforeCompacted = host.compactedContext.length;

    await mgr.appendToContext({ role: 'user', content: 'new' });

    expect(host.rawContext.length).toBe(beforeRaw + 1);
    expect(host.compactedContext.length).toBe(beforeCompacted + 1);
  });
});
