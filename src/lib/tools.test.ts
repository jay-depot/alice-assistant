import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Tool } from './tool-system.js';

// tools.ts and conversation-types.ts both carry module-level state.
// We reset both on every test so each test starts with a clean slate.

type ToolsModule = typeof import('./tools.js');
type TypesModule = typeof import('./conversation-types.js');

const makeMinimalTool = (overrides: Partial<Tool> = {}): Tool => ({
  name: 'testTool',
  description: 'A tool for testing.',
  availableFor: ['chat'],
  systemPromptFragment: '',
  toolResultPromptIntro: '',
  toolResultPromptOutro: '',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async () => 'result',
  ...overrides,
});

describe('addTool', () => {
  let tools: ToolsModule;
  let types: TypesModule;

  beforeEach(async () => {
    vi.resetModules();
    types = await import('./conversation-types.js');
    tools = await import('./tools.js');
    // 'chat' is a built-in type, so it's available without any extra setup.
  });

  it('registers a tool for a known conversation type', () => {
    tools.addTool(makeMinimalTool({ name: 'myTool', availableFor: ['chat'] }));
    expect(tools.hasTool('myTool')).toBe(true);
  });

  it('throws when the tool references an unknown conversation type', () => {
    expect(() =>
      tools.addTool(makeMinimalTool({ availableFor: ['unknown-type'] }))
    ).toThrowError(/unknown-type/);
  });

  it('throws and names the tool in the error', () => {
    expect(() =>
      tools.addTool(
        makeMinimalTool({ name: 'badTool', availableFor: ['no-such'] })
      )
    ).toThrowError(/badTool/);
  });

  it('can register a custom conversation type and then a tool for it', () => {
    types.registerConversationType(
      {
        id: 'custom',
        name: 'Custom',
        description: 'Custom type',
        baseType: 'chat',
      },
      'test-plugin'
    );
    expect(() =>
      tools.addTool(
        makeMinimalTool({ name: 'customTool', availableFor: ['custom'] })
      )
    ).not.toThrow();
    expect(tools.hasTool('customTool')).toBe(true);
  });
});

describe('getTools', () => {
  let tools: ToolsModule;

  beforeEach(async () => {
    vi.resetModules();
    await import('./conversation-types.js'); // resets type registry
    tools = await import('./tools.js');
    tools.addTool(
      makeMinimalTool({ name: 'chatOnlyTool', availableFor: ['chat'] })
    );
    tools.addTool(
      makeMinimalTool({ name: 'voiceTool', availableFor: ['voice'] })
    );
    tools.addTool(
      makeMinimalTool({ name: 'bothTool', availableFor: ['chat', 'voice'] })
    );
  });

  it('returns only tools available for the given type', () => {
    const chatTools = tools.getTools('chat');
    const names = chatTools.map(t => t.name);
    expect(names).toContain('chatOnlyTool');
    expect(names).toContain('bothTool');
    expect(names).not.toContain('voiceTool');
  });

  it('returns an empty array for a type with no tools', () => {
    expect(tools.getTools('startup')).toEqual([]);
  });
});

describe('hasTool', () => {
  let tools: ToolsModule;

  beforeEach(async () => {
    vi.resetModules();
    await import('./conversation-types.js');
    tools = await import('./tools.js');
  });

  it('returns false before any tool is registered', () => {
    expect(tools.hasTool('anything')).toBe(false);
  });

  it('returns true for a registered tool', () => {
    tools.addTool(makeMinimalTool({ name: 'knownTool' }));
    expect(tools.hasTool('knownTool')).toBe(true);
  });

  it('returns false for an unregistered tool name', () => {
    tools.addTool(makeMinimalTool({ name: 'knownTool' }));
    expect(tools.hasTool('otherTool')).toBe(false);
  });
});

describe('addConversationTypeToTool', () => {
  let tools: ToolsModule;

  beforeEach(async () => {
    vi.resetModules();
    await import('./conversation-types.js');
    tools = await import('./tools.js');
    tools.addTool(makeMinimalTool({ name: 'myTool', availableFor: ['chat'] }));
  });

  it('adds a new valid conversation type to an existing tool', () => {
    tools.addConversationTypeToTool('myTool', 'voice');
    expect(tools.getTools('voice').some(t => t.name === 'myTool')).toBe(true);
  });

  it('is idempotent — adding the same type twice does not duplicate it', () => {
    tools.addConversationTypeToTool('myTool', 'voice');
    tools.addConversationTypeToTool('myTool', 'voice');
    const voiceTools = tools.getTools('voice').filter(t => t.name === 'myTool');
    expect(voiceTools).toHaveLength(1);
  });

  it('throws when the tool does not exist', () => {
    expect(() =>
      tools.addConversationTypeToTool('missingTool', 'voice')
    ).toThrowError(/missingTool/);
  });

  it('throws when the conversation type does not exist', () => {
    expect(() =>
      tools.addConversationTypeToTool('myTool', 'no-such-type')
    ).toThrowError(/no-such-type/);
  });
});
