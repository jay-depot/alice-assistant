/* eslint-disable @typescript-eslint/no-unused-vars */
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

import type { AlicePluginInterface } from '../../../lib.js';
import proficienciesPlugin from './proficiencies.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ProficiencyRow = {
  id: number;
  name: string;
  normalizedName: string;
  recallWhen: string;
  contents: string;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  _deleted?: boolean;
};

function createMockOrm(initialRows: Partial<ProficiencyRow>[] = []) {
  let nextId = 1;
  const rows: ProficiencyRow[] = initialRows.map(r => ({
    id: nextId++,
    name: '',
    normalizedName: '',
    recallWhen: '',
    contents: '',
    usageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: new Date(),
    ...r,
  }));

  const em = {
    fork: () => em,
    find: vi.fn(async (_entity: any, _where: any, _opts?: any) =>
      rows.filter(r => !r._deleted)
    ),
    findOne: vi.fn(async (_entity: any, where: Record<string, any>) => {
      return (
        rows.find(
          r =>
            !r._deleted &&
            Object.entries(where).every(
              ([k, v]) => (r as Record<string, any>)[k] === v
            )
        ) ?? null
      );
    }),
    create: vi.fn((_entity: any, data: any) => {
      const row = { ...data, id: nextId++ };
      rows.push(row as ProficiencyRow);
      return row;
    }),
    persist: vi.fn(),
    remove: vi.fn((row: any) => {
      row._deleted = true;
      return em;
    }),
    flush: vi.fn().mockResolvedValue(undefined),
  };

  return { em, rows };
}

function createMockPluginInterface(
  opts: {
    maxProficiencies?: number;
    initialRows?: Partial<ProficiencyRow>[];
  } = {}
) {
  const { maxProficiencies = 30, initialRows = [] } = opts;
  const orm = createMockOrm(initialRows);
  const mockRegisterSkillFile = vi.fn();
  const registeredTools: any[] = [];
  const registeredHeaderPrompts: any[] = [];
  const registeredFooterPrompts: any[] = [];

  return {
    orm,
    registeredTools,
    registeredHeaderPrompts,
    registeredFooterPrompts,
    mockRegisterSkillFile,
    registerPlugin: async () => ({
      registerTool: (def: any) => registeredTools.push(def),
      registerHeaderSystemPrompt: (def: any) =>
        registeredHeaderPrompts.push(def),
      registerFooterSystemPrompt: (def: any) =>
        registeredFooterPrompts.push(def),
      offer: vi.fn(),
      addToolToConversationType: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      config: vi.fn().mockResolvedValue({
        getPluginConfig: () => ({ maxProficiencies }),
        getSystemConfig: () => ({ configDirectory: '/mock/config' }),
      }),
      request: (pluginId: string) => {
        if (pluginId === 'memory') {
          return {
            registerDatabaseModels: vi.fn(),
            onDatabaseReady: vi.fn(async (cb: (orm: any) => Promise<any>) =>
              cb(orm)
            ),
          };
        }
        if (pluginId === 'skills') {
          return { registerSkillFile: mockRegisterSkillFile };
        }
        return undefined;
      },
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

describe('proficienciesPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;

  beforeEach(async () => {
    mockInterface = createMockPluginInterface();
    await proficienciesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  it('has correct plugin metadata', () => {
    expect(proficienciesPlugin.pluginMetadata).toMatchObject({
      id: 'proficiencies',
      name: 'Proficiencies Plugin',
      version: 'LATEST',
      required: false,
    });
  });

  it('declares dependencies on memory and skills', () => {
    const depIds = proficienciesPlugin.pluginMetadata.dependencies!.map(
      d => d.id
    );
    expect(depIds).toContain('memory');
    expect(depIds).toContain('skills');
  });

  // -------------------------------------------------------------------------
  // Tool registration
  // -------------------------------------------------------------------------

  it('registers recallProficiency, createProficiency, and updateProficiency tools', () => {
    const names = mockInterface.registeredTools.map(t => t.name);
    expect(names).toContain('recallProficiency');
    expect(names).toContain('createProficiency');
    expect(names).toContain('updateProficiency');
  });

  it('all tools are available for chat, voice, and autonomy', () => {
    for (const tool of mockInterface.registeredTools) {
      expect(tool.availableFor).toContain('chat');
      expect(tool.availableFor).toContain('voice');
      expect(tool.availableFor).toContain('autonomy');
    }
  });

  // -------------------------------------------------------------------------
  // System prompts
  // -------------------------------------------------------------------------

  it('registers a header prompt with weight 60', () => {
    const header = mockInterface.registeredHeaderPrompts.find(
      p => p.name === 'proficiencies'
    );
    expect(header).toBeDefined();
    expect(header.weight).toBe(60);
  });

  it('registers a footer prompt with weight 11000', () => {
    const footer = mockInterface.registeredFooterPrompts.find(
      p => p.name === 'proficiencies'
    );
    expect(footer).toBeDefined();
    expect(footer.weight).toBe(11000);
  });

  it('registers a skill file during plugin registration', () => {
    expect(mockInterface.mockRegisterSkillFile).toHaveBeenCalledOnce();
    expect(mockInterface.mockRegisterSkillFile).toHaveBeenCalledWith(
      expect.stringContaining('Proficiencies.md')
    );
  });

  // -------------------------------------------------------------------------
  // recallProficiency
  // -------------------------------------------------------------------------

  it('recallProficiency returns formatted proficiency when found', async () => {
    mockInterface = createMockPluginInterface({
      initialRows: [
        {
          name: 'BakingTips',
          normalizedName: 'bakingtips',
          recallWhen: 'user asks about baking',
          contents: 'Preheat oven to 350.',
          usageCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastAccessedAt: new Date(),
        },
      ],
    });
    await proficienciesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'recallProficiency'
    );
    const result = await tool.execute({ proficiencyName: 'BakingTips' });

    expect(result).toContain('BakingTips');
    expect(result).toContain('Preheat oven to 350.');
    expect(result).toContain('baking');
  });

  it('recallProficiency increments usageCount on each recall', async () => {
    const now = new Date();
    mockInterface = createMockPluginInterface({
      initialRows: [
        {
          name: 'Cooking',
          normalizedName: 'cooking',
          recallWhen: 'food',
          contents: 'Content.',
          usageCount: 3,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        },
      ],
    });
    await proficienciesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'recallProficiency'
    );
    await tool.execute({ proficiencyName: 'Cooking' });

    const row = mockInterface.orm.rows.find(
      r => r.normalizedName === 'cooking'
    );
    expect(row?.usageCount).toBe(4);
  });

  it('recallProficiency returns a not-found message for an unknown name', async () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'recallProficiency'
    );
    const result = await tool.execute({ proficiencyName: 'DoesNotExist' });
    expect(result).toMatch(/DoesNotExist/);
    expect(result).toMatch(/not found|no proficiency/i);
  });

  it('recallProficiency returns an error for an empty name', async () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'recallProficiency'
    );
    const result = await tool.execute({ proficiencyName: '   ' });
    expect(result).toMatch(/non-empty/i);
  });

  // -------------------------------------------------------------------------
  // createProficiency
  // -------------------------------------------------------------------------

  it('createProficiency creates a new entry and returns a success message', async () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'createProficiency'
    );
    const result = await tool.execute({
      proficiencyName: 'CssGrid',
      recallWhen: 'user asks about CSS layouts',
      contents: 'CSS grid cheat sheet content.',
    });

    expect(result).toContain('CssGrid');
    const row = mockInterface.orm.rows.find(r => r.name === 'CssGrid');
    expect(row).toBeDefined();
    expect(row?.normalizedName).toBe('cssgrid');
  });

  it('createProficiency returns an error for an empty name', async () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'createProficiency'
    );
    const result = await tool.execute({
      proficiencyName: '',
      recallWhen: 'always',
      contents: '',
    });
    expect(result).toMatch(/non-empty/i);
  });

  it('createProficiency returns an error for an empty recallWhen', async () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'createProficiency'
    );
    const result = await tool.execute({
      proficiencyName: 'SomeSkill',
      recallWhen: '   ',
      contents: '',
    });
    expect(result).toMatch(/non-empty/i);
  });

  it('createProficiency returns an error when a proficiency with the same name already exists', async () => {
    const now = new Date();
    mockInterface = createMockPluginInterface({
      initialRows: [
        {
          name: 'TypeScript',
          normalizedName: 'typescript',
          recallWhen: 'TS stuff',
          contents: 'Existing.',
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        },
      ],
    });
    await proficienciesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'createProficiency'
    );
    const result = await tool.execute({
      proficiencyName: 'TypeScript',
      recallWhen: 'TS',
      contents: 'Another.',
    });

    expect(result).toMatch(/already exists/i);
    expect(result).toContain('TypeScript');
  });

  it('createProficiency removes the least-used entry when maxProficiencies is exceeded', async () => {
    const oldDate = new Date('2020-01-01T00:00:00Z');
    mockInterface = createMockPluginInterface({
      maxProficiencies: 1,
      initialRows: [
        {
          name: 'OldProficiency',
          normalizedName: 'oldproficiency',
          recallWhen: 'old stuff',
          contents: 'Old content.',
          usageCount: 0,
          createdAt: oldDate,
          updatedAt: oldDate,
          lastAccessedAt: oldDate,
        },
      ],
    });
    await proficienciesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'createProficiency'
    );
    const result = await tool.execute({
      proficiencyName: 'NewProficiency',
      recallWhen: 'new stuff',
      contents: 'New content.',
    });

    expect(result).toMatch(/removed proficiency/i);
    expect(result).toContain('OldProficiency');
  });

  it('createProficiency keeps the newly created proficiency when trimming to maxProficiencies', async () => {
    const now = new Date('2026-04-12T00:00:00Z');
    mockInterface = createMockPluginInterface({
      maxProficiencies: 1,
      initialRows: [
        {
          name: 'HighValueExisting',
          normalizedName: 'highvalueexisting',
          recallWhen: 'important recurring tasks',
          contents: 'Existing high-value notes.',
          usageCount: 999,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        },
      ],
    });
    await proficienciesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'createProficiency'
    );
    await tool.execute({
      proficiencyName: 'KeepMe',
      recallWhen: 'new workflow',
      contents: 'Fresh notes.',
    });

    const newEntry = mockInterface.orm.rows.find(
      r => r.normalizedName === 'keepme'
    );
    const oldEntry = mockInterface.orm.rows.find(
      r => r.normalizedName === 'highvalueexisting'
    );

    expect(newEntry?._deleted).not.toBe(true);
    expect(oldEntry?._deleted).toBe(true);
  });

  // -------------------------------------------------------------------------
  // updateProficiency
  // -------------------------------------------------------------------------

  it('updateProficiency updates the recallWhen field', async () => {
    const now = new Date();
    mockInterface = createMockPluginInterface({
      initialRows: [
        {
          name: 'Regex',
          normalizedName: 'regex',
          recallWhen: 'old trigger',
          contents: 'Some regex notes.',
          usageCount: 1,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        },
      ],
    });
    await proficienciesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'updateProficiency'
    );
    const result = await tool.execute({
      proficiencyName: 'Regex',
      recallWhen: 'user asks about regex patterns',
    });

    expect(result).toContain('Regex');
    const row = mockInterface.orm.rows.find(r => r.normalizedName === 'regex');
    expect(row?.recallWhen).toBe('user asks about regex patterns');
  });

  it('updateProficiency replaces contents by default', async () => {
    const now = new Date();
    mockInterface = createMockPluginInterface({
      initialRows: [
        {
          name: 'Notes',
          normalizedName: 'notes',
          recallWhen: 'something',
          contents: 'Original.',
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        },
      ],
    });
    await proficienciesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'updateProficiency'
    );
    await tool.execute({ proficiencyName: 'Notes', contents: 'Replaced.' });

    const row = mockInterface.orm.rows.find(r => r.normalizedName === 'notes');
    expect(row?.contents).toBe('Replaced.');
  });

  it('updateProficiency replaces contents when format is full', async () => {
    const now = new Date();
    mockInterface = createMockPluginInterface({
      initialRows: [
        {
          name: 'Notes',
          normalizedName: 'notes',
          recallWhen: 'something',
          contents: 'Original.',
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        },
      ],
    });
    await proficienciesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'updateProficiency'
    );
    // Use format=full to replace contents (simulating the old append: true behavior
    // is now done via format=full with the combined text)
    await tool.execute({
      proficiencyName: 'Notes',
      contents: 'Original.\nAppended.',
      format: 'full',
    });

    const row = mockInterface.orm.rows.find(r => r.normalizedName === 'notes');
    expect(row?.contents).toContain('Original.');
    expect(row?.contents).toContain('Appended.');
  });

  it('updateProficiency returns a not-found message for an unknown name', async () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'updateProficiency'
    );
    const result = await tool.execute({
      proficiencyName: 'Ghost',
      contents: 'Update.',
    });
    expect(result).toMatch(/Ghost/);
    expect(result).toMatch(/not found|no proficiency/i);
  });

  it('updateProficiency returns an error when neither recallWhen nor contents are provided', async () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'updateProficiency'
    );
    const result = await tool.execute({ proficiencyName: 'Something' });
    expect(result).toMatch(/recallWhen|contents/);
  });

  it('updateProficiency returns an error for an empty name', async () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'updateProficiency'
    );
    const result = await tool.execute({
      proficiencyName: '   ',
      contents: 'Update.',
    });
    expect(result).toMatch(/non-empty/i);
  });

  // -------------------------------------------------------------------------
  // Header system prompt
  // -------------------------------------------------------------------------

  it('header prompt returns false for the startup conversation type', async () => {
    const header = mockInterface.registeredHeaderPrompts.find(
      p => p.name === 'proficiencies'
    );
    const result = await header.getPrompt({
      conversationType: 'startup',
      sessionId: 'x',
    });
    expect(result).toBe(false);
  });

  it('header prompt seeds and returns the default proficiency when none exist', async () => {
    const header = mockInterface.registeredHeaderPrompts.find(
      p => p.name === 'proficiencies'
    );
    const result = await header.getPrompt({
      conversationType: 'chat',
      sessionId: 'x',
      availableTools: ['recallProficiency'],
    });
    expect(typeof result).toBe('string');
    expect(result).toContain('ProficienciesWelcome');
    expect(result).toContain('quick refresher');
  });

  it('header prompt includes proficiency names and recallWhen when entries exist', async () => {
    const now = new Date();
    mockInterface = createMockPluginInterface({
      initialRows: [
        {
          name: 'CssGrid',
          normalizedName: 'cssgrid',
          recallWhen: 'CSS layouts',
          contents: 'Grid content.',
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        },
      ],
    });
    await proficienciesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const header = mockInterface.registeredHeaderPrompts.find(
      p => p.name === 'proficiencies'
    );
    const result = await header.getPrompt({
      conversationType: 'chat',
      sessionId: 'x',
      availableTools: ['recallProficiency'],
    });

    expect(result).toContain('CssGrid');
    expect(result).toContain('CSS layouts');
  });

  // -------------------------------------------------------------------------
  // Footer system prompt
  // -------------------------------------------------------------------------

  it('footer prompt returns false for the startup conversation type', async () => {
    const footer = mockInterface.registeredFooterPrompts.find(
      p => p.name === 'proficiencies'
    );
    const result = await footer.getPrompt({
      conversationType: 'startup',
      sessionId: 'x',
    });
    expect(result).toBe(false);
  });

  it('footer prompt returns the update reminder string for non-startup conversations', async () => {
    const footer = mockInterface.registeredFooterPrompts.find(
      p => p.name === 'proficiencies'
    );
    const result = await footer.getPrompt({
      conversationType: 'chat',
      sessionId: 'x',
      availableTools: ['recallProficiency', 'updateProficiency'],
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/update/i);
    expect(result).toMatch(/proficien/i);
  });
});
