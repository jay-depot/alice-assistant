import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  PersonalityProvider,
  PersonalityRenderContext,
} from './personality-system.js';

type PersonalityModule = typeof import('./personality-system.js');

const makeProvider = (text: string): PersonalityProvider => ({
  renderPrompt: () => text,
});

describe('personality provider registration', () => {
  let m: PersonalityModule;

  beforeEach(async () => {
    vi.resetModules();
    m = await import('./personality-system.js');
  });

  // ---- registerFallbackPersonalityProvider ----

  it('registers the fallback provider', () => {
    m.registerFallbackPersonalityProvider('plugin-a', makeProvider('fallback'));
    expect(m.getFallbackPersonalityProviderOwner()).toBe('plugin-a');
  });

  it('allows the same plugin to re-register the fallback (idempotent owner check)', () => {
    m.registerFallbackPersonalityProvider('plugin-a', makeProvider('v1'));
    expect(() =>
      m.registerFallbackPersonalityProvider('plugin-a', makeProvider('v2'))
    ).not.toThrow();
  });

  it('throws when a different plugin tries to register the fallback', () => {
    m.registerFallbackPersonalityProvider('plugin-a', makeProvider('first'));
    expect(() =>
      m.registerFallbackPersonalityProvider('plugin-b', makeProvider('second'))
    ).toThrow(/plugin-a/);
  });

  it('throw message names the conflicting plugin', () => {
    m.registerFallbackPersonalityProvider('plugin-a', makeProvider('first'));
    expect(() =>
      m.registerFallbackPersonalityProvider('plugin-b', makeProvider('second'))
    ).toThrow(/plugin-b/);
  });

  // ---- registerPersonalityProvider (active override) ----

  it('registers the active personality provider override', () => {
    m.registerPersonalityProvider('plugin-x', makeProvider('override'));
    expect(m.getActivePersonalityProviderOverrideOwner()).toBe('plugin-x');
  });

  it('allows the same plugin to re-register the active override', () => {
    m.registerPersonalityProvider('plugin-x', makeProvider('v1'));
    expect(() =>
      m.registerPersonalityProvider('plugin-x', makeProvider('v2'))
    ).not.toThrow();
  });

  it('throws when a different plugin tries to register the active override', () => {
    m.registerPersonalityProvider('plugin-x', makeProvider('first'));
    expect(() =>
      m.registerPersonalityProvider('plugin-y', makeProvider('second'))
    ).toThrow(/plugin-x/);
  });
});

describe('getActivePersonalityProviderOwner', () => {
  let m: PersonalityModule;

  beforeEach(async () => {
    vi.resetModules();
    m = await import('./personality-system.js');
  });

  it('returns undefined when no provider is registered', () => {
    expect(m.getActivePersonalityProviderOwner()).toBeUndefined();
  });

  it('returns the fallback owner when only the fallback is registered', () => {
    m.registerFallbackPersonalityProvider(
      'fallback-plugin',
      makeProvider('fb')
    );
    expect(m.getActivePersonalityProviderOwner()).toBe('fallback-plugin');
  });

  it('returns the override owner when an override is registered', () => {
    m.registerFallbackPersonalityProvider(
      'fallback-plugin',
      makeProvider('fb')
    );
    m.registerPersonalityProvider('override-plugin', makeProvider('ov'));
    expect(m.getActivePersonalityProviderOwner()).toBe('override-plugin');
  });
});

describe('renderPersonalityPrompt', () => {
  let m: PersonalityModule;
  const conversationContext: PersonalityRenderContext = {
    purpose: 'conversation-header',
  };
  const notificationContext: PersonalityRenderContext = {
    purpose: 'notification',
  };

  beforeEach(async () => {
    vi.resetModules();
    m = await import('./personality-system.js');
  });

  it('returns a non-empty default prompt for conversation-header when no provider is set', async () => {
    const result = await m.renderPersonalityPrompt(conversationContext);
    expect(typeof result).toBe('string');
    expect(result.trim().length).toBeGreaterThan(0);
  });

  it('returns a different default for notification purpose when no provider is set', async () => {
    const conversation = await m.renderPersonalityPrompt(conversationContext);
    const notification = await m.renderPersonalityPrompt(notificationContext);
    expect(conversation).not.toBe(notification);
  });

  it('uses the fallback provider when only the fallback is registered', async () => {
    m.registerFallbackPersonalityProvider(
      'fb-plugin',
      makeProvider('FALLBACK PROMPT')
    );
    const result = await m.renderPersonalityPrompt(conversationContext);
    expect(result).toBe('FALLBACK PROMPT');
  });

  it('uses the active override even when a fallback is also registered', async () => {
    m.registerFallbackPersonalityProvider(
      'fb-plugin',
      makeProvider('FALLBACK')
    );
    m.registerPersonalityProvider('ov-plugin', makeProvider('OVERRIDE'));
    const result = await m.renderPersonalityPrompt(conversationContext);
    expect(result).toBe('OVERRIDE');
  });

  it('passes the render context to the provider', async () => {
    const received: PersonalityRenderContext[] = [];
    m.registerPersonalityProvider('spy-plugin', {
      renderPrompt: ctx => {
        received.push(ctx);
        return 'spy';
      },
    });
    await m.renderPersonalityPrompt(notificationContext);
    expect(received[0]).toBe(notificationContext);
  });
});
