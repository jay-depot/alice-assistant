/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import * as fs from 'node:fs';

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

import type { AlicePluginInterface } from '../../../lib.js';
import type { RegisteredSkill } from './skills.js';
import SkillsPlugin from './skills.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function createMockPluginInterface() {
  const registeredTools: any[] = [];
  const registeredHeaderPrompts: any[] = [];
  const offeredCapabilities: Record<string, any> = {};

  return {
    registeredTools,
    registeredHeaderPrompts,
    offeredCapabilities,
    registerPlugin: async () => ({
      registerTool: (def: any) => registeredTools.push(def),
      registerHeaderSystemPrompt: (def: any) =>
        registeredHeaderPrompts.push(def),
      registerFooterSystemPrompt: vi.fn(),
      offer: (caps: any) => {
        offeredCapabilities['skills'] = caps;
      },
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

describe('SkillsPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'skills-test-'));
    mockInterface = createMockPluginInterface();
    await SkillsPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has correct plugin metadata', () => {
    expect(SkillsPlugin.pluginMetadata).toMatchObject({
      id: 'skills',
      name: 'Skills Plugin',
      version: 'LATEST',
      required: false,
    });
  });

  it('has no plugin dependencies', () => {
    expect(SkillsPlugin.pluginMetadata.dependencies).toEqual([]);
  });

  it('offers registerSkill and registerSkillFile', () => {
    const api = mockInterface.offeredCapabilities['skills'];
    expect(typeof api.registerSkill).toBe('function');
    expect(typeof api.registerSkillFile).toBe('function');
  });

  it('registers the recallSkill tool available for chat, voice, and autonomy', () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'recallSkill'
    );
    expect(tool).toBeDefined();
    expect(tool.availableFor).toContain('chat');
    expect(tool.availableFor).toContain('voice');
    expect(tool.availableFor).toContain('autonomy');
  });

  it('registers a header system prompt named skills', () => {
    expect(mockInterface.registeredHeaderPrompts).toHaveLength(1);
    expect(mockInterface.registeredHeaderPrompts[0].name).toBe('skills');
  });

  it('registerSkill adds a skill accessible via recallSkill tool', async () => {
    const api = mockInterface.offeredCapabilities['skills'];
    api.registerSkill({
      id: 'test-skill',
      recallWhen: 'testing things',
      contents: 'Do the tests.',
    } satisfies RegisteredSkill);

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'recallSkill'
    );
    const result = await tool.execute({ skillId: 'test-skill' });
    expect(result).toBe('Do the tests.');
  });

  it('registerSkill throws when registering a duplicate skill id', () => {
    const api = mockInterface.offeredCapabilities['skills'];
    api.registerSkill({ id: 'my-skill', recallWhen: 'always', contents: 'A' });
    expect(() =>
      api.registerSkill({
        id: 'my-skill',
        recallWhen: 'again',
        contents: 'B',
      })
    ).toThrow(/my-skill/);
  });

  it('recallSkill returns the full skill contents by id', async () => {
    const api = mockInterface.offeredCapabilities['skills'];
    api.registerSkill({
      id: 'cooking',
      recallWhen: 'cooking topic',
      contents: 'Preheat oven to 350.',
    });
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'recallSkill'
    );
    const result = await tool.execute({ skillId: 'cooking' });
    expect(result).toBe('Preheat oven to 350.');
  });

  it('recallSkill returns a not-found message for an unknown skill id', async () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'recallSkill'
    );
    const result = await tool.execute({ skillId: 'nonexistent' });
    expect(result).toMatch(/nonexistent/);
    expect(result).toMatch(/nonexistent found/i);
  });

  it('header prompt returns false for the startup conversation type', () => {
    const api = mockInterface.offeredCapabilities['skills'];
    api.registerSkill({ id: 's', recallWhen: 'always', contents: 'Content' });
    const prompt = mockInterface.registeredHeaderPrompts[0];
    const result = prompt.getPrompt({
      conversationType: 'startup',
      sessionId: 'x',
      availableTools: ['recallSkill'],
    });
    expect(result).toBe(false);
  });

  it('header prompt returns false when no skills are registered', () => {
    const prompt = mockInterface.registeredHeaderPrompts[0];
    const result = prompt.getPrompt({
      conversationType: 'chat',
      sessionId: 'x',
    });
    expect(result).toBe(false);
  });

  it('header prompt includes registered skill ids and recallWhen conditions', () => {
    const api = mockInterface.offeredCapabilities['skills'];
    api.registerSkill({
      id: 'baking',
      recallWhen: 'user asks about baking',
      contents: 'Bake at 350.',
    });
    const prompt = mockInterface.registeredHeaderPrompts[0];
    const result = prompt.getPrompt({
      conversationType: 'chat',
      sessionId: 'x',
      availableTools: ['recallSkill'],
    });
    expect(result).toContain('baking');
    expect(result).toContain('user asks about baking');
  });

  it('registerSkillFile parses a valid skill file and registers the skill', async () => {
    const skillFilePath = nodePath.join(tmpDir, 'my-skill.md');
    fs.writeFileSync(
      skillFilePath,
      JSON.stringify({ id: 'file-skill', recallWhen: 'file stuff' }) +
        '\n---\n# File Skill\nThis skill came from a file.'
    );

    const api = mockInterface.offeredCapabilities['skills'];
    await api.registerSkillFile(skillFilePath);

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'recallSkill'
    );
    const result = await tool.execute({ skillId: 'file-skill' });
    expect(result).toContain('File Skill');
  });

  it('registerSkillFile throws when file has no --- separator', async () => {
    const skillFilePath = nodePath.join(tmpDir, 'bad.md');
    fs.writeFileSync(skillFilePath, 'No separator here at all');

    const api = mockInterface.offeredCapabilities['skills'];
    await expect(api.registerSkillFile(skillFilePath)).rejects.toThrow();
  });

  it('registerSkillFile throws when metadata is not valid JSON', async () => {
    const skillFilePath = nodePath.join(tmpDir, 'bad-json.md');
    fs.writeFileSync(skillFilePath, 'not valid json\n---\nContent here');

    const api = mockInterface.offeredCapabilities['skills'];
    await expect(api.registerSkillFile(skillFilePath)).rejects.toThrow();
  });

  it('registerSkillFile throws when required metadata fields are missing', async () => {
    const skillFilePath = nodePath.join(tmpDir, 'missing-fields.md');
    fs.writeFileSync(
      skillFilePath,
      JSON.stringify({ id: 'only-id' }) + '\n---\nContent here'
    );

    const api = mockInterface.offeredCapabilities['skills'];
    await expect(api.registerSkillFile(skillFilePath)).rejects.toThrow(
      /missing required fields/i
    );
  });

  it('registerSkillFile preserves content that itself contains ---', async () => {
    const skillFilePath = nodePath.join(tmpDir, 'multi-sep.md');
    fs.writeFileSync(
      skillFilePath,
      JSON.stringify({ id: 'sep-skill', recallWhen: 'always' }) +
        '\n---\nFirst section\n---\nSecond section'
    );

    const api = mockInterface.offeredCapabilities['skills'];
    await api.registerSkillFile(skillFilePath);

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'recallSkill'
    );
    const result = await tool.execute({ skillId: 'sep-skill' });
    expect(result).toContain('First section');
    expect(result).toContain('Second section');
  });
});
