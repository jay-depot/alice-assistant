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

const { mockExists, mockReaddir, mockMkdir } = vi.hoisted(() => ({
  mockExists: vi.fn(),
  mockReaddir: vi.fn(),
  mockMkdir: vi.fn(),
}));

vi.mock('../../../lib/node/fs-promised.js', () => ({
  exists: mockExists,
}));

vi.mock('fs/promises', () => ({
  readdir: mockReaddir,
  mkdir: mockMkdir,
}));

import type { AlicePluginInterface } from '../../../lib.js';
import userSkillsPlugin from './user-skills.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Expected skills directory given the mocked configDirectory=/mock/config
const SKILLS_DIR = '/mock/config/plugin-settings/user-skills/skills';

function createMockPluginInterface() {
  const mockRegisterSkillFile = vi.fn();

  return {
    mockRegisterSkillFile,
    registerPlugin: async () => ({
      registerTool: vi.fn(),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      offer: vi.fn(),
      addToolToConversationType: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      config: vi.fn().mockResolvedValue({
        getPluginConfig: () => ({}),
        getSystemConfig: () => ({ configDirectory: '/mock/config' }),
      }),
      request: (pluginId: string) => {
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

describe('userSkillsPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;

  beforeEach(() => {
    mockExists.mockReset().mockResolvedValue(true);
    mockReaddir.mockReset().mockResolvedValue([]);
    mockMkdir.mockReset().mockResolvedValue(undefined);
    mockInterface = createMockPluginInterface();
  });

  it('has correct plugin metadata', () => {
    expect(userSkillsPlugin.pluginMetadata).toMatchObject({
      id: 'user-skills',
      name: 'User Skills Plugin',
      version: 'LATEST',
      required: false,
    });
  });

  it('declares a dependency on skills', () => {
    const depIds = userSkillsPlugin.pluginMetadata.dependencies!.map(d => d.id);
    expect(depIds).toContain('skills');
  });

  it('registers .md files found in the user skills directory', async () => {
    mockReaddir.mockResolvedValue(['cooking.md', 'fitness.md']);
    await userSkillsPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockInterface.mockRegisterSkillFile).toHaveBeenCalledTimes(2);
    expect(mockInterface.mockRegisterSkillFile).toHaveBeenCalledWith(
      expect.stringContaining('cooking.md')
    );
    expect(mockInterface.mockRegisterSkillFile).toHaveBeenCalledWith(
      expect.stringContaining('fitness.md')
    );
  });

  it('passes the correctly constructed absolute path to registerSkillFile', async () => {
    mockReaddir.mockResolvedValue(['my-skill.md']);
    await userSkillsPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockInterface.mockRegisterSkillFile).toHaveBeenCalledWith(
      `${SKILLS_DIR}/my-skill.md`
    );
  });

  it('skips files whose name starts with a dot', async () => {
    mockReaddir.mockResolvedValue(['.hidden.md', 'visible.md']);
    await userSkillsPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockInterface.mockRegisterSkillFile).toHaveBeenCalledTimes(1);
    expect(mockInterface.mockRegisterSkillFile).not.toHaveBeenCalledWith(
      expect.stringContaining('.hidden.md')
    );
  });

  it('skips non-.md files', async () => {
    mockReaddir.mockResolvedValue(['skill.txt', 'notes.json', 'valid.md']);
    await userSkillsPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockInterface.mockRegisterSkillFile).toHaveBeenCalledTimes(1);
    expect(mockInterface.mockRegisterSkillFile).toHaveBeenCalledWith(
      expect.stringContaining('valid.md')
    );
  });

  it('creates the skills directory with recursive:true when it does not exist', async () => {
    mockExists.mockResolvedValue(false);
    await userSkillsPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockMkdir).toHaveBeenCalledWith(SKILLS_DIR, { recursive: true });
  });

  it('does not call registerSkillFile when directory had to be created', async () => {
    mockExists.mockResolvedValue(false);
    await userSkillsPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockInterface.mockRegisterSkillFile).not.toHaveBeenCalled();
  });

  it('does not create the directory when it already exists', async () => {
    mockExists.mockResolvedValue(true);
    await userSkillsPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockMkdir).not.toHaveBeenCalled();
  });

  it('does not call registerSkillFile when the directory is empty', async () => {
    mockReaddir.mockResolvedValue([]);
    await userSkillsPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockInterface.mockRegisterSkillFile).not.toHaveBeenCalled();
  });
});
