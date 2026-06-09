import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock('ollama', () => ({
  default: {
    chat: vi.fn(),
  },
}));

vi.mock('./user-config.js', () => ({
  UserConfig: {
    getConfig: vi.fn().mockReturnValue({
      ollama: {
        host: 'http://localhost:11434',
        model: 'test-model',
        options: {},
      },
    }),
  },
}));

// plugin-hooks is pulled in transitively; stub it so no lib.js circular-import
// issues surface during test collection.
vi.mock('./plugin-hooks.js', () => ({
  PluginHooks: vi.fn(() => ({})),
  PluginHookInvocations: {
    invokeOnContextCompactionSummariesWillBeDeleted: vi
      .fn()
      .mockResolvedValue(undefined),
    invokeOnUserConversationWillBegin: vi.fn().mockResolvedValue(undefined),
    invokeOnUserConversationWillEnd: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Conversation instance state management (no Ollama calls)
// ---------------------------------------------------------------------------

describe('Conversation state management', () => {
  let Conversation: typeof import('./conversation.js').Conversation;

  beforeEach(async () => {
    ({ Conversation } = await import('./conversation.js'));
  });

  it('starts with empty raw context', () => {
    const conv = new Conversation('chat');
    expect(conv.rawContext).toEqual([]);
  });

  it('restoreContext sets rawContext and compactedContext', () => {
    const conv = new Conversation('chat');
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    conv.restoreContext(messages);
    expect(conv.rawContext).toEqual(messages);
    expect(conv.compactedContext).toEqual(messages);
  });

  it('restoreContext returns the same instance for chaining', () => {
    const conv = new Conversation('chat');
    const result = conv.restoreContext([]);
    expect(result).toBe(conv);
  });

  it('restoreContext throws if called a second time', () => {
    const conv = new Conversation('chat');
    conv.restoreContext([{ role: 'user', content: 'first' }]);
    expect(() =>
      conv.restoreContext([{ role: 'user', content: 'second' }])
    ).toThrow();
  });

  it('getUnsynchronizedMessages returns messages added after last sync point', () => {
    const conv = new Conversation('chat');
    const existing = [{ role: 'user', content: 'old' }];
    conv.restoreContext(existing);
    // rawContext has 1 message; synchronizedRawMessageCount == 1
    // Nothing new yet
    expect(conv.getUnsynchronizedMessages()).toEqual([]);
  });

  it('markUnsynchronizedMessagesSynchronized advances the sync pointer', () => {
    const conv = new Conversation('chat');
    conv.restoreContext([]);
    // Manually push a message so we can verify the pointer moves
    conv.rawContext.push({ role: 'user', content: 'new' });
    expect(conv.getUnsynchronizedMessages()).toHaveLength(1);
    conv.markUnsynchronizedMessagesSynchronized();
    expect(conv.getUnsynchronizedMessages()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sendDirectRequest (with Ollama mock)
// ---------------------------------------------------------------------------

describe('Conversation.sendDirectRequest', () => {
  let Conversation: typeof import('./conversation.js').Conversation;
  let mockChat: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ Conversation } = await import('./conversation.js'));
    const OllamaClient = (await import('ollama')).default;
    mockChat = vi.mocked(OllamaClient.chat);
  });

  it('returns the content from a successful LLM response', async () => {
    mockChat.mockResolvedValue({
      message: { role: 'assistant', content: 'Hello!' },
    });

    const result = await Conversation.sendDirectRequest([
      { role: 'user', content: 'Ping' },
    ]);

    expect(result).toBe('Hello!');
  });

  it('returns an empty string when the LLM returns no content', async () => {
    mockChat.mockResolvedValue({ message: { role: 'assistant', content: '' } });

    const result = await Conversation.sendDirectRequest([
      { role: 'user', content: 'Ping' },
    ]);

    expect(result).toBe('');
  });

  it('retries and succeeds after a degenerate first response', async () => {
    const degenerate = Array(22).fill('word').join(' ');
    mockChat
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: degenerate },
      })
      .mockResolvedValue({
        message: { role: 'assistant', content: 'Good response' },
      });

    const result = await Conversation.sendDirectRequest([
      { role: 'user', content: 'Try me' },
    ]);

    expect(result).toBe('Good response');
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  it('throws after all retries are exhausted on persistent degeneracy', async () => {
    const degenerate = Array(22).fill('word').join(' ');
    mockChat.mockResolvedValue({
      message: { role: 'assistant', content: degenerate },
    });

    await expect(
      Conversation.sendDirectRequest([{ role: 'user', content: 'go' }])
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// compactContext modes
// ---------------------------------------------------------------------------

describe('compactContext', () => {
  let Conversation: typeof import('./conversation.js').Conversation;
  let mockChat: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('ollama');
    mockChat = (mod.default as unknown as { chat: ReturnType<typeof vi.fn> })
      .chat;
    mockChat.mockReset();
    ({ Conversation } = await import('./conversation.js'));
  });

  it('compactContext("normal") returns false when context is small', async () => {
    const conv = new Conversation('chat');
    conv.restoreContext([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]);

    const result = await conv.compactContext('normal');
    expect(result).toBe(false);
  });

  it('compactContext("full") summarizes all non-summary messages', async () => {
    mockChat.mockResolvedValue({
      message: { role: 'assistant', content: 'Summary of conversation.' },
    });

    const conv = new Conversation('chat');
    conv.restoreContext([
      { role: 'user', content: 'Tell me about cats.' },
      { role: 'assistant', content: 'Cats are wonderful pets.' },
      { role: 'user', content: 'What about dogs?' },
      { role: 'assistant', content: 'Dogs are loyal companions.' },
    ]);

    const result = await conv.compactContext('full');
    expect(result).toBe(true);
    expect(conv.compactedContext).toHaveLength(1);
    expect(conv.compactedContext[0].content).toContain(
      'Summary of conversation.'
    );
  });

  it('compactContext("full") returns false when everything is already summaries', async () => {
    const conv = new Conversation('chat');
    conv.restoreContext([
      {
        role: 'system',
        content:
          '# Summary of earlier conversation:\n \n1/1/2026\n\nAlready summarized.',
      },
    ]);

    const result = await conv.compactContext('full');
    expect(result).toBe(false);
  });

  it('compactContext("clear") evicts all summaries to memory hook', async () => {
    mockChat.mockResolvedValue({
      message: { role: 'assistant', content: 'Final summary.' },
    });

    const { PluginHookInvocations } = await import('./plugin-hooks.js');

    const conv = new Conversation('chat');
    conv.restoreContext([
      { role: 'user', content: 'Important question.' },
      { role: 'assistant', content: 'Important answer.' },
    ]);

    const result = await conv.compactContext('clear');
    expect(result).toBe(true);
    expect(conv.compactedContext).toHaveLength(0);
    expect(
      PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted
    ).toHaveBeenCalled();
  });
});
