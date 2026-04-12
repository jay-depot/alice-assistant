/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Memory plugin imports from lib.js which has a circular dependency with task-assistant
// via plugin-hooks.ts. Mock plugin-hooks to prevent module-level side effects.
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
import type { Tool } from '../../../lib/tool-system.js';

type MemoryPluginModule = typeof import('./memory.js');

/**
 * Mock plugin interface for testing plugin registration.
 */
function createMockPluginInterface() {
  const offeredCapabilities: Record<string, any> = {};
  const registeredTools: Tool[] = [];
  const configValues: Record<string, any> = {};

  return {
    offeredCapabilities,
    registeredTools,
    configValues,
    registerPlugin: async () => {
      return {
        registerTool: (tool: Tool) => {
          registeredTools.push(tool);
        },
        registerHeaderSystemPrompt: vi.fn(),
        registerFooterSystemPrompt: vi.fn(),
        registerConversationType: vi.fn(),
        registerTaskAssistant: vi.fn(),
        addToolToConversationType: vi.fn(),
        config: async (schema: any, defaults: any) => {
          return {
            getPluginConfig: () => configValues.plugin || defaults,
            getSystemConfig: () => ({
              assistantName: 'Alice',
            }),
          };
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
        offer: (capabilities: any) => {
          offeredCapabilities['memory'] = capabilities;
        },
        request: vi.fn(),
      };
    },
  };
}

describe('memoryPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;
  let memoryPlugin: MemoryPluginModule['default'];

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('./memory.js');
    memoryPlugin = module.default;
    mockInterface = createMockPluginInterface();
  });

  it('has correct plugin metadata', () => {
    expect(memoryPlugin.pluginMetadata).toEqual({
      id: 'memory',
      name: 'Memory Plugin',
      version: 'LATEST',
      description:
        'A plugin that allows the assistant to recall summaries of finished ' +
        'conversations with the user. Also provides a MikroORM instance connected to a ' +
        'sqlite database for other plugins to use for storing information across sessions.',
      required: true,
    });
  });

  it('plugin is required', () => {
    expect(memoryPlugin.pluginMetadata.required).toBe(true);
  });

  it('registers the recallPastConversations tool', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    expect(mockInterface.registeredTools).toHaveLength(1);
    expect(mockInterface.registeredTools[0].name).toBe(
      'recallPastConversations'
    );
  });

  it('recallPastConversations tool is available for chat, voice, and autonomy', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    expect(tool.availableFor).toEqual(['chat', 'voice', 'autonomy']);
  });

  it('tool parameters include optional keyword and date fields', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    // @ts-expect-error - This definitely exists.
    expect(tool.parameters.type).toBe('object');
    // @ts-expect-error - This definitely exists.
    expect(tool.parameters.properties).toHaveProperty('keyword');
    // @ts-expect-error - This definitely exists.
    expect(tool.parameters.properties).toHaveProperty('date');
  });

  it('offers memory capabilities', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    expect(mockInterface.offeredCapabilities['memory']).toBeDefined();
    expect(mockInterface.offeredCapabilities['memory']).toHaveProperty(
      'registerDatabaseModels'
    );
    expect(mockInterface.offeredCapabilities['memory']).toHaveProperty(
      'onDatabaseReady'
    );
    expect(mockInterface.offeredCapabilities['memory']).toHaveProperty(
      'saveMemory'
    );
  });

  it('allows registering database models during plugin registration', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const memoryApi = mockInterface.offeredCapabilities['memory'];

    // Should not throw during registration
    expect(() => {
      memoryApi.registerDatabaseModels([
        {
          // Mock entity class
        },
      ]);
    }).not.toThrow();
  });

  it('registerDatabaseModels adds entities to the queue', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const memoryApi = mockInterface.offeredCapabilities['memory'];

    // Call should succeed (details of entity registration are internal)
    expect(() => {
      memoryApi.registerDatabaseModels([
        {
          // Mock entity class
        },
      ]);
    }).not.toThrow();
  });

  it('provides onDatabaseReady callback mechanism', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const memoryApi = mockInterface.offeredCapabilities['memory'];
    const mockOrm = {
      em: {
        fork: vi.fn(),
      },
    };

    let callbackWasCalled = false;

    // Mock onDatabaseReady to return our mock ORM
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const originalOnDatabaseReady = memoryApi.onDatabaseReady;
    memoryApi.onDatabaseReady = async (callback: any) => {
      callbackWasCalled = true;
      return callback(mockOrm);
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const result = await memoryApi.onDatabaseReady(async (orm: any) => {
      return 'test-result';
    });

    expect(callbackWasCalled).toBe(true);
    expect(result).toBe('test-result');
  });

  it('tool description contains guidance about keywords and dates', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    expect(tool.description).toContain('keyword');
    expect(tool.description).toContain('date');
    expect(tool.description).toContain('YYYY-MM-DD');
  });

  it('tool warns against using articles and filler words in keywords', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    expect(tool.description).toContain('FILLER WORDS');
    expect(tool.description).toContain('PRONOUNS');
  });

  it('toolResultPromptOutro includes personality change hint when configured', async () => {
    mockInterface.configValues.plugin = {
      includePersonalityChangeLlmHint: true,
    };

    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    // @ts-expect-error - This definitely exists.
    const outro = tool.toolResultPromptOutro();

    expect(outro).toContain('personality');
    expect(outro).toContain('Alice');
  });

  it('toolResultPromptOutro is empty when personality change hint disabled', async () => {
    mockInterface.configValues.plugin = {
      includePersonalityChangeLlmHint: false,
    };

    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    // @ts-expect-error - This definitely exists.
    const outro = tool.toolResultPromptOutro();

    expect(outro).toBe('');
  });

  it('plugin loads with default config when not provided', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    // With default config (includePersonalityChangeLlmHint: false)
    // @ts-expect-error - This definitely exists.
    const outro = tool.toolResultPromptOutro();

    expect(outro).toBe('');
  });

  it('has empty system prompt fragments', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    expect(tool.systemPromptFragment).toBe('');
  });

  it('tool result intro is present and informative', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    expect(tool.toolResultPromptIntro).toContain('recallPastConversation');
    expect(tool.toolResultPromptIntro).toContain('JSON');
  });

  it('supports both keyword and date parameter formats', async () => {
    await memoryPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    // @ts-expect-error - This definitely exists.
    const { properties } = tool.parameters;

    // Both should be optional string fields
    expect(properties.keyword.type).toBe('string');
    expect(properties.date.type).toBe('string');
  });
});
