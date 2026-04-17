/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  mockListConversationTypes,
  mockGetConversationTypeOwner,
  mockGetLoadedPlugins,
} = vi.hoisted(() => ({
  mockListConversationTypes: vi.fn(),
  mockGetConversationTypeOwner: vi.fn(),
  mockGetLoadedPlugins: vi.fn(),
}));

vi.mock('../../../lib.js', () => ({
  listConversationTypes: mockListConversationTypes,
  getConversationTypeOwner: mockGetConversationTypeOwner,
}));

vi.mock('../../../lib/alice-plugin-engine.js', () => ({
  AlicePluginEngine: {
    getLoadedPlugins: mockGetLoadedPlugins,
  },
}));

import type { AlicePluginInterface } from '../../../lib.js';
import troubleshootingPlugin from './troubleshooting.js';

function createMockPluginInterface() {
  const tools: any[] = [];
  const footerPrompts: any[] = [];

  return {
    tools,
    footerPrompts,
    registerPlugin: async () => ({
      registerTool: (tool: any) => tools.push(tool),
      registerFooterSystemPrompt: (prompt: any) => footerPrompts.push(prompt),
      request: vi.fn(),
      registerHeaderSystemPrompt: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      config: vi.fn(),
      offer: vi.fn(),
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

describe('troubleshootingPlugin', () => {
  beforeEach(() => {
    mockListConversationTypes.mockReset().mockReturnValue([
      { id: 'chat', name: 'Chat', description: 'Default chat' },
      { id: 'voice', name: 'Voice', description: 'Voice chat' },
    ]);
    mockGetConversationTypeOwner
      .mockReset()
      .mockImplementation((id: string) => (id === 'voice' ? 'voice' : 'core'));
    mockGetLoadedPlugins.mockReset().mockReturnValue([
      { id: 'memory', name: 'Memory', version: 'LATEST' },
      { id: 'web-ui', name: 'Web UI Plugin', version: 'LATEST' },
    ]);
  });

  it('has correct plugin metadata', () => {
    expect(troubleshootingPlugin.pluginMetadata).toMatchObject({
      id: 'troubleshooting',
      name: 'Troubleshooting Plugin',
      version: 'LATEST',
      required: false,
    });
    expect(troubleshootingPlugin.pluginMetadata.dependencies).toEqual([]);
  });

  it('registers getAssistantDebugInfo tool for chat and voice', async () => {
    const mockInterface = createMockPluginInterface();
    await troubleshootingPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.tools.find(
      toolDef => toolDef.name === 'getAssistantDebugInfo'
    );

    expect(tool).toBeDefined();
    expect(tool.availableFor).toContain('chat');
    expect(tool.availableFor).toContain('voice');
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('getAssistantDebugInfo returns loaded plugins and conversation types', async () => {
    const mockInterface = createMockPluginInterface();
    await troubleshootingPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.tools.find(
      toolDef => toolDef.name === 'getAssistantDebugInfo'
    );
    const result = await tool.execute();

    expect(result).toContain('Loaded plugins:');
    expect(result).toContain('Memory (id: memory, version: LATEST)');
    expect(result).toContain('Web UI Plugin (id: web-ui, version: LATEST)');

    expect(result).toContain('Registered conversation types:');
    expect(result).toContain('Chat (id: chat, plugin: core)');
    expect(result).toContain('Voice (id: voice, plugin: voice)');
  });

  it('registers troubleshooting footer prompt with expected guidance', async () => {
    const mockInterface = createMockPluginInterface();
    await troubleshootingPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    expect(mockInterface.footerPrompts).toHaveLength(1);
    const footer = mockInterface.footerPrompts[0];
    expect(footer.name).toBe('troubleshootingFooter');
    expect(footer.weight).toBe(0);

    const prompt = footer.getPrompt({
      availableTools: ['getAssistantDebugInfo'],
    });
    expect(prompt).toContain('getAssistantDebugInfo');
    expect(prompt).toContain('ALICE.md');
    expect(prompt).toContain('troubleshooting');
  });
});
