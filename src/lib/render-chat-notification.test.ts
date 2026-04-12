import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NotificationPayload } from './render-chat-notification.js';

// ---------------------------------------------------------------------------
// Mocks (hoisted — must be at top level of file)
// ---------------------------------------------------------------------------

vi.mock('../lib.js', () => ({
  Conversation: {
    sendDirectRequest: vi.fn(),
  },
}));

vi.mock('./personality-system.js', () => ({
  renderPersonalityPrompt: vi.fn().mockResolvedValue('You are ALICE.'),
}));

vi.mock('./user-config.js', () => ({
  UserConfig: {
    getConfig: vi.fn().mockReturnValue({ assistantName: 'ALICE' }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePayload = (
  overrides: Partial<NotificationPayload> = {}
): NotificationPayload => ({
  title: 'Test Title',
  message: 'Test message.',
  source: 'test-source',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Pure function tests (Phase 1) — no mocks needed
// ---------------------------------------------------------------------------

describe('buildFallbackChatNotification', () => {
  // Import lazily so the mock stubs above don't interfere with the pure functions
  // (they don't, but this makes the dependency explicit).
  let buildFallbackChatNotification: (n: NotificationPayload) => string;

  beforeEach(async () => {
    ({ buildFallbackChatNotification } =
      await import('./render-chat-notification.js'));
  });

  it('starts with "Quick interruption."', () => {
    const result = buildFallbackChatNotification(makePayload());
    expect(result.startsWith('Quick interruption.')).toBe(true);
  });

  it('includes both title and message when they differ', () => {
    const result = buildFallbackChatNotification(makePayload());
    expect(result).toContain('Test Title');
    expect(result).toContain('Test message.');
  });

  it('omits the title when it equals the message', () => {
    const result = buildFallbackChatNotification(
      makePayload({ title: 'Same text', message: 'Same text' })
    );
    // Title line should NOT be duplicated; only one occurrence of the text
    const occurrences = result.split('Same text').length - 1;
    expect(occurrences).toBe(1);
  });

  it('omits an empty title', () => {
    const result = buildFallbackChatNotification(makePayload({ title: '' }));
    // Should only have "Quick interruption." and the message — no blank section
    expect(result.split('\n\n').filter(Boolean)).toHaveLength(2);
  });

  it('omits a whitespace-only title', () => {
    const result = buildFallbackChatNotification(makePayload({ title: '   ' }));
    expect(result.split('\n\n').filter(Boolean)).toHaveLength(2);
  });
});

describe('buildNotificationChatTitle', () => {
  let buildNotificationChatTitle: (n: NotificationPayload) => string;

  beforeEach(async () => {
    ({ buildNotificationChatTitle } =
      await import('./render-chat-notification.js'));
  });

  it('prefixes with "Notification: "', () => {
    const result = buildNotificationChatTitle(makePayload({ title: 'Hi' }));
    expect(result.startsWith('Notification: ')).toBe(true);
  });

  it('uses the title when it is non-empty', () => {
    expect(
      buildNotificationChatTitle(
        makePayload({ title: 'My Title', message: 'Other' })
      )
    ).toBe('Notification: My Title');
  });

  it('falls back to the message when the title is empty', () => {
    expect(
      buildNotificationChatTitle(
        makePayload({ title: '', message: 'The message' })
      )
    ).toBe('Notification: The message');
  });

  it('returns the default label when both title and message are empty', () => {
    expect(
      buildNotificationChatTitle(makePayload({ title: '', message: '' }))
    ).toBe('Notification: Needs Attention');
  });

  it('normalizes multiple spaces', () => {
    expect(
      buildNotificationChatTitle(makePayload({ title: 'Too  Many   Spaces' }))
    ).toBe('Notification: Too Many Spaces');
  });

  it('clips the display portion to exactly 48 characters when the title is too long', () => {
    const longTitle = 'A'.repeat(50);
    const result = buildNotificationChatTitle(
      makePayload({ title: longTitle })
    );
    const displayPart = result.replace('Notification: ', '');
    expect(displayPart).toHaveLength(48); // 45 chars + "..."
    expect(displayPart.endsWith('...')).toBe(true);
  });

  it('does not clip a title of exactly 48 characters', () => {
    const exactTitle = 'B'.repeat(48);
    const result = buildNotificationChatTitle(
      makePayload({ title: exactTitle })
    );
    expect(result).toBe(`Notification: ${'B'.repeat(48)}`);
    expect(result).not.toContain('...');
  });
});

// ---------------------------------------------------------------------------
// Mocked I/O test (Phase 3)
// ---------------------------------------------------------------------------

describe('renderChatNotificationInVoice', () => {
  let renderChatNotificationInVoice: (
    n: NotificationPayload,
    scenario: string,
    sessionId?: number
  ) => Promise<string>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ renderChatNotificationInVoice } =
      await import('./render-chat-notification.js'));
  });

  it('returns the trimmed LLM response', async () => {
    const { Conversation } = await import('../lib.js');
    vi.mocked(Conversation.sendDirectRequest).mockResolvedValue(
      '  Hello there.  '
    );

    const result = await renderChatNotificationInVoice(
      makePayload({ title: 'Alert', message: 'Something happened.' }),
      'Deliver this as a gentle heads-up.'
    );

    expect(result).toBe('Hello there.');
  });

  it('calls sendDirectRequest with three messages', async () => {
    const { Conversation } = await import('../lib.js');
    vi.mocked(Conversation.sendDirectRequest).mockResolvedValue('ok');

    await renderChatNotificationInVoice(makePayload(), 'scenario');

    const [messages] = vi.mocked(Conversation.sendDirectRequest).mock.calls[0];
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('system');
    expect(messages[2].role).toBe('user');
  });

  it('includes the notification content in the user message', async () => {
    const { Conversation } = await import('../lib.js');
    vi.mocked(Conversation.sendDirectRequest).mockResolvedValue('noted');

    await renderChatNotificationInVoice(
      makePayload({
        title: 'Door open',
        message: 'Front door left open.',
        source: 'sensor',
      }),
      'scenario'
    );

    const [messages] = vi.mocked(Conversation.sendDirectRequest).mock.calls[0];
    expect(messages[2].content).toContain('Door open');
    expect(messages[2].content).toContain('Front door left open.');
  });
});
