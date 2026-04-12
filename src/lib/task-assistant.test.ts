import { describe, it, expect, vi } from 'vitest';
import { createDeferred } from './task-assistant.js';

// task-assistant.ts → conversation.ts → plugin-hooks.ts → lib.ts → task-assistant.ts
// plugin-hooks.ts calls TaskAssistantEvents.onBegin() at module level, which resolves
// to undefined due to the circular dep when loaded in test isolation.  Stub it out.
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

describe('createDeferred', () => {
  it('exposes a promise before settling', () => {
    const deferred = createDeferred<string>();
    expect(deferred.promise).toBeInstanceOf(Promise);
  });

  it('resolves with the provided value', async () => {
    const deferred = createDeferred<number>();
    deferred.resolve(42);
    await expect(deferred.promise).resolves.toBe(42);
  });

  it('rejects with the provided reason', async () => {
    const deferred = createDeferred<void>();
    deferred.reject(new Error('boom'));
    await expect(deferred.promise).rejects.toThrow('boom');
  });

  it('creates independent deferreds that do not cross-resolve', async () => {
    const a = createDeferred<string>();
    const b = createDeferred<string>();
    a.resolve('alpha');
    b.resolve('beta');
    await expect(a.promise).resolves.toBe('alpha');
    await expect(b.promise).resolves.toBe('beta');
  });
});
