import { describe, it, expect, beforeEach, vi } from 'vitest';

// conversation-types.ts is a module with top-level Map state.
// We use vi.resetModules() + dynamic imports so each test gets a fresh module.

type ConversationTypesModule = typeof import('./conversation-types.js');

describe('Built-in conversation type read-only access', () => {
  let m: ConversationTypesModule;

  beforeEach(async () => {
    vi.resetModules();
    m = await import('./conversation-types.js');
  });

  it('BUILT_IN_CONVERSATION_TYPE_IDS contains exactly the four built-in IDs', () => {
    expect([...m.BUILT_IN_CONVERSATION_TYPE_IDS]).toEqual(
      expect.arrayContaining(['voice', 'chat', 'startup', 'autonomy'])
    );
    expect(m.BUILT_IN_CONVERSATION_TYPE_IDS).toHaveLength(4);
  });

  it('isBuiltInConversationType returns true for each built-in ID', () => {
    for (const id of ['voice', 'chat', 'startup', 'autonomy'] as const) {
      expect(m.isBuiltInConversationType(id)).toBe(true);
    }
  });

  it('isBuiltInConversationType returns false for a custom ID', () => {
    expect(m.isBuiltInConversationType('my-custom-type')).toBe(false);
  });

  it('listBuiltInConversationTypes returns the four built-in definitions', () => {
    const types = m.listBuiltInConversationTypes();
    expect(types).toHaveLength(4);
    expect(types.map(t => t.id)).toEqual(
      expect.arrayContaining(['voice', 'chat', 'startup', 'autonomy'])
    );
  });

  it('hasConversationType returns true for built-in types', () => {
    expect(m.hasConversationType('chat')).toBe(true);
    expect(m.hasConversationType('voice')).toBe(true);
  });

  it('hasConversationType returns false for an unknown type', () => {
    expect(m.hasConversationType('nonexistent')).toBe(false);
  });

  it('getConversationTypeDefinition returns the definition for built-in types', () => {
    const def = m.getConversationTypeDefinition('chat');
    expect(def).toBeDefined();
    expect(def?.id).toBe('chat');
    expect(def?.name).toBeTruthy();
  });

  it('getConversationTypeDefinition returns undefined for unknown types', () => {
    expect(m.getConversationTypeDefinition('unknown')).toBeUndefined();
  });

  it('getConversationTypeOwner returns "core" for built-in types', () => {
    expect(m.getConversationTypeOwner('chat')).toBe('core');
    expect(m.getConversationTypeOwner('voice')).toBe('core');
  });
});

describe('registerConversationType', () => {
  let m: ConversationTypesModule;

  beforeEach(async () => {
    vi.resetModules();
    m = await import('./conversation-types.js');
  });

  const validDefinition = {
    id: 'my-custom-type',
    name: 'My Custom Type',
    description: 'A test conversation type.',
    baseType: 'chat' as const,
  };

  it('registers a valid custom conversation type', () => {
    m.registerConversationType(validDefinition, 'my-plugin');
    expect(m.hasConversationType('my-custom-type')).toBe(true);
  });

  it('makes the registered type accessible via getConversationTypeDefinition', () => {
    m.registerConversationType(validDefinition, 'my-plugin');
    const def = m.getConversationTypeDefinition('my-custom-type');
    expect(def?.id).toBe('my-custom-type');
    expect(def?.name).toBe('My Custom Type');
  });

  it('records the correct owner plugin ID', () => {
    m.registerConversationType(validDefinition, 'my-plugin');
    expect(m.getConversationTypeOwner('my-custom-type')).toBe('my-plugin');
  });

  it('defaults includePersonality to true when omitted', () => {
    m.registerConversationType(validDefinition, 'my-plugin');
    expect(
      m.getConversationTypeDefinition('my-custom-type')?.includePersonality
    ).toBe(true);
  });

  it('throws when registering a duplicate ID', () => {
    m.registerConversationType(validDefinition, 'plugin-a');
    expect(() =>
      m.registerConversationType(validDefinition, 'plugin-b')
    ).toThrowError(/plugin-a/);
  });

  it('throws when registering a duplicate ID and names both plugins in the message', () => {
    m.registerConversationType(validDefinition, 'plugin-a');
    expect(() =>
      m.registerConversationType(validDefinition, 'plugin-b')
    ).toThrowError(/plugin-b/);
  });

  it('throws when the name is empty', () => {
    expect(() =>
      m.registerConversationType({ ...validDefinition, name: '' }, 'my-plugin')
    ).toThrow();
  });

  it('throws when the name is whitespace-only', () => {
    expect(() =>
      m.registerConversationType(
        { ...validDefinition, name: '   ' },
        'my-plugin'
      )
    ).toThrow();
  });

  it('throws when the description is empty', () => {
    expect(() =>
      m.registerConversationType(
        { ...validDefinition, description: '' },
        'my-plugin'
      )
    ).toThrow();
  });

  it('throws when an invalid baseType is given', () => {
    expect(() =>
      m.registerConversationType(
        { ...validDefinition, baseType: 'invalid' as 'chat' },
        'my-plugin'
      )
    ).toThrowError(/voice|chat|startup|autonomy/);
  });

  it('includes the new type in listConversationTypes', () => {
    m.registerConversationType(validDefinition, 'my-plugin');
    const ids = m.listConversationTypes().map(t => t.id);
    expect(ids).toContain('my-custom-type');
  });
});
