import { describe, it, expect } from 'vitest';
import {
  getMessageKey,
  getMessageIdentityKey,
  isDisplayableMessage,
} from './utils.js';

describe('getMessageKey', () => {
  it('includes role, messageKind, timestamp, and content', () => {
    const key = getMessageKey({
      role: 'user',
      messageKind: 'chat',
      timestamp: '2025-01-01T00:00:00Z',
      content: 'hello',
    });
    expect(key).toBe('user:chat:2025-01-01T00:00:00Z:hello');
  });

  it('produces different keys for different timestamps with same content', () => {
    const key1 = getMessageKey({
      role: 'user',
      messageKind: 'chat',
      timestamp: '2025-01-01T00:00:00Z',
      content: 'hello',
    });
    const key2 = getMessageKey({
      role: 'user',
      messageKind: 'chat',
      timestamp: '2025-01-01T00:00:01Z',
      content: 'hello',
    });
    expect(key1).not.toBe(key2);
  });
});

describe('getMessageIdentityKey', () => {
  it('uses only role and content', () => {
    const key = getMessageIdentityKey({
      role: 'assistant',
      content: 'Hello, world!',
    });
    expect(key).toBe('assistant:Hello, world!');
  });

  it('ignores timestamp — same content produces same key', () => {
    const key1 = getMessageIdentityKey({
      role: 'assistant',
      content: 'response text',
    });
    const key2 = getMessageIdentityKey({
      role: 'assistant',
      content: 'response text',
    });
    expect(key1).toBe(key2);
  });

  it('ignores messageKind — only role and content matter', () => {
    const key1 = getMessageIdentityKey({
      role: 'user',
      content: 'hello',
    });
    const key2 = getMessageIdentityKey({
      role: 'user',
      content: 'hello',
    });
    expect(key1).toBe(key2);
  });

  it('produces different keys for different content', () => {
    const key1 = getMessageIdentityKey({
      role: 'user',
      content: 'hello',
    });
    const key2 = getMessageIdentityKey({
      role: 'user',
      content: 'goodbye',
    });
    expect(key1).not.toBe(key2);
  });

  it('differentiates by role', () => {
    const userKey = getMessageIdentityKey({
      role: 'user',
      content: 'hello',
    });
    const assistantKey = getMessageIdentityKey({
      role: 'assistant',
      content: 'hello',
    });
    expect(userKey).not.toBe(assistantKey);
  });

  it('handles empty content', () => {
    const key = getMessageIdentityKey({
      role: 'assistant',
      content: '',
    });
    expect(key).toBe('assistant:');
  });

  it('handles very long content', () => {
    const content = 'a'.repeat(10000);
    const key = getMessageIdentityKey({ role: 'user', content });
    expect(key).toBe(`user:${content}`);
  });
});

describe('isDisplayableMessage', () => {
  it('filters empty assistant chat messages', () => {
    expect(
      isDisplayableMessage({
        role: 'assistant',
        messageKind: 'chat',
        content: '',
      })
    ).toBe(false);
    expect(
      isDisplayableMessage({
        role: 'assistant',
        messageKind: 'chat',
        content: '   ',
      })
    ).toBe(false);
  });

  it('shows assistant chat messages with content', () => {
    expect(
      isDisplayableMessage({
        role: 'assistant',
        messageKind: 'chat',
        content: 'Hello',
      })
    ).toBe(true);
  });

  it('shows non-chat assistant messages regardless of content', () => {
    expect(
      isDisplayableMessage({
        role: 'assistant',
        messageKind: 'notification',
        content: '',
      })
    ).toBe(true);
    expect(
      isDisplayableMessage({
        role: 'assistant',
        messageKind: 'tool_call',
        content: '',
      })
    ).toBe(true);
  });

  it('shows user messages regardless of content', () => {
    expect(
      isDisplayableMessage({
        role: 'user',
        messageKind: 'chat',
        content: '',
      })
    ).toBe(true);
  });
});
