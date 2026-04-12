/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Break circular dep chain via plugin-hooks
vi.mock('../../../lib/plugin-hooks.js', () => ({
  PluginHooks: vi.fn(() => ({})),
  PluginHookInvocations: {
    invokeOnContextCompactionSummariesWillBeDeleted: vi
      .fn()
      .mockResolvedValue(undefined),
    invokeOnUserConversationWillBegin: vi.fn().mockResolvedValue(undefined),
    invokeOnUserConversationWillEnd: vi.fn().mockResolvedValue(undefined),
  },
}));

// Hoist mutable mock functions so vi.mock factories can reference them
const {
  mockReaddir,
  mockReadFile,
  mockGetActivePersonalityProviderOverrideOwner,
  mockRegisterFallbackPersonalityProvider,
  mockGetConversationTypeDefinition,
} = vi.hoisted(() => ({
  mockReaddir: vi.fn(),
  mockReadFile: vi.fn(),
  mockGetActivePersonalityProviderOverrideOwner: vi.fn(),
  mockRegisterFallbackPersonalityProvider: vi.fn(),
  mockGetConversationTypeDefinition: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
}));

vi.mock('../../../lib/personality-system.js', () => ({
  registerFallbackPersonalityProvider: mockRegisterFallbackPersonalityProvider,
  getActivePersonalityProviderOverrideOwner:
    mockGetActivePersonalityProviderOverrideOwner,
}));

vi.mock('../../../lib/conversation-types.js', () => ({
  getConversationTypeDefinition: mockGetConversationTypeDefinition,
}));

vi.mock('../../../lib/user-config.js', () => ({
  UserConfig: { getConfigPath: () => '/mock/config' },
}));

import type { AlicePluginInterface } from '../../../lib.js';
import personalityPlugin from './personality.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDirent(name: string, isFile = true) {
  return { name, isFile: () => isFile, isDirectory: () => !isFile };
}

function createMockPluginInterface() {
  const registeredHeaderPrompts: any[] = [];
  return {
    registeredHeaderPrompts,
    registerPlugin: async () => ({
      registerHeaderSystemPrompt: (def: any) =>
        registeredHeaderPrompts.push(def),
      registerFooterSystemPrompt: vi.fn(),
      registerTool: vi.fn(),
      offer: vi.fn(),
      request: vi.fn(),
      config: vi.fn(),
      addToolToConversationType: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      hooks: {
        onAllPluginsLoaded: vi.fn(),
        onAssistantWillAcceptRequests: vi.fn(),
        onAssistantAcceptsRequests: vi.fn(),
        onAssistantWillStopAcceptingRequests: vi.fn(),
        onAssistantStoppedAcceptingRequests: vi.fn(),
        onPluginsWillUnload: vi.fn(),
        onTaskAssistantWillBegin: vi.fn(),
        onTaskAssistantWillEnd: vi.fn(),
        onUserConversationWillBegin: vi.fn(),
        onUserConversationWillEnd: vi.fn(),
        onContextCompactionSummariesWillBeDeleted: vi.fn(),
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('personalityPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;

  beforeEach(async () => {
    mockGetActivePersonalityProviderOverrideOwner
      .mockReset()
      .mockReturnValue(null);
    mockGetConversationTypeDefinition.mockReset().mockReturnValue(undefined);
    mockReaddir.mockReset().mockResolvedValue([]);
    mockReadFile.mockReset().mockResolvedValue('');
    mockRegisterFallbackPersonalityProvider.mockReset();

    mockInterface = createMockPluginInterface();
    await personalityPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
  });

  it('has correct plugin metadata', () => {
    expect(personalityPlugin.pluginMetadata).toMatchObject({
      id: 'personality',
      name: 'Personality',
      version: 'LATEST',
      required: false,
    });
  });

  it('has no plugin dependencies', () => {
    expect(personalityPlugin.pluginMetadata.dependencies).toEqual([]);
  });

  it('calls registerFallbackPersonalityProvider on registration', () => {
    expect(mockRegisterFallbackPersonalityProvider).toHaveBeenCalledWith(
      'personality',
      expect.objectContaining({ renderPrompt: expect.any(Function) })
    );
  });

  it('registers exactly one header system prompt named personality', () => {
    expect(mockInterface.registeredHeaderPrompts).toHaveLength(1);
    expect(mockInterface.registeredHeaderPrompts[0].name).toBe('personality');
  });

  it('header system prompt has weight -9999', () => {
    expect(mockInterface.registeredHeaderPrompts[0].weight).toBe(-9999);
  });

  it('header prompt returns false when an active personality override exists', async () => {
    mockGetActivePersonalityProviderOverrideOwner.mockReturnValue(
      'some-other-plugin'
    );
    const prompt = mockInterface.registeredHeaderPrompts[0];
    const result = await prompt.getPrompt({
      conversationType: 'chat',
      sessionId: 'x',
    });
    expect(result).toBe(false);
  });

  it('header prompt returns false when the conversation type has includePersonality=false', async () => {
    mockGetConversationTypeDefinition.mockReturnValue({
      includePersonality: false,
    });
    const prompt = mockInterface.registeredHeaderPrompts[0];
    const result = await prompt.getPrompt({
      conversationType: 'startup',
      sessionId: 'x',
    });
    expect(result).toBe(false);
  });

  it('header prompt renders INTRO and QUIRKS sections from personality files', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('intro.md'),
      makeDirent('quirks.md'),
    ]);
    mockReadFile
      .mockResolvedValueOnce('I am your assistant.')
      .mockResolvedValueOnce('I enjoy wordplay.');

    const prompt = mockInterface.registeredHeaderPrompts[0];
    const result = await prompt.getPrompt({
      conversationType: 'chat',
      sessionId: 'x',
    });

    expect(result).toContain('INTRODUCTION');
    expect(result).toContain('PERSONALITY QUIRKS');
    expect(result).toContain('I am your assistant.');
    expect(result).toContain('I enjoy wordplay.');
  });

  it('INTRO section appears before QUIRKS section in the rendered prompt', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('quirks.md'), // deliberately unsorted — plugin sorts them
      makeDirent('intro.md'),
    ]);
    mockReadFile.mockImplementation(async (p: string) => {
      if ((p as string).includes('intro.md')) return 'INTRO CONTENT';
      if ((p as string).includes('quirks.md')) return 'QUIRKS CONTENT';
      return '';
    });

    const prompt = mockInterface.registeredHeaderPrompts[0];
    const result = (await prompt.getPrompt({
      conversationType: 'chat',
      sessionId: 'x',
    })) as string;

    expect(result.indexOf('INTRODUCTION')).toBeLessThan(
      result.indexOf('PERSONALITY QUIRKS')
    );
  });

  it('non-.md files in the personality directory are excluded', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('notes.txt'),
      makeDirent('config.json'),
      makeDirent('intro.md'),
    ]);
    mockReadFile.mockResolvedValue('Content');

    const prompt = mockInterface.registeredHeaderPrompts[0];
    await prompt.getPrompt({ conversationType: 'chat', sessionId: 'x' });

    // Only intro.md should trigger a readFile call
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('personality files are processed in alphabetical order', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('zzz-section.md'), // reversed — plugin should sort
      makeDirent('aaa-section.md'),
    ]);
    mockReadFile.mockImplementation(async (p: string) => {
      if ((p as string).includes('zzz')) return 'ZZZ CONTENT';
      if ((p as string).includes('aaa')) return 'AAA CONTENT';
      return '';
    });

    const prompt = mockInterface.registeredHeaderPrompts[0];
    const result = (await prompt.getPrompt({
      conversationType: 'chat',
      sessionId: 'x',
    })) as string;

    expect(result.indexOf('AAA CONTENT')).toBeLessThan(
      result.indexOf('ZZZ CONTENT')
    );
  });

  it('renders an overall personality header regardless of file contents', async () => {
    mockReaddir.mockResolvedValue([makeDirent('intro.md')]);
    mockReadFile.mockResolvedValue('Hello world.');

    const prompt = mockInterface.registeredHeaderPrompts[0];
    const result = await prompt.getPrompt({
      conversationType: 'chat',
      sessionId: 'x',
    });

    expect(result).toContain('PC DIGITAL ASSISTANT');
  });
});
