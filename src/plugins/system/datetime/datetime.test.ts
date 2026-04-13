import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { format } from 'date-fns';
import type { AlicePluginInterface } from '../../../lib.js';
import datetimePlugin from './datetime.js';

/**
 * Mock plugin interface for testing plugin registration.
 */
function createMockPluginInterface() {
  const registeredFooterPrompts: Array<{
    name: string;
    weight: number;
    getPrompt: () => Promise<string>;
  }> = [];

  return {
    registeredFooterPrompts,
    registerPlugin: async () => {
      return {
        logger: {
          log: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
        registerTool: vi.fn(),
        registerHeaderSystemPrompt: vi.fn(),
        registerFooterSystemPrompt: (def: {
          name: string;
          weight: number;
          getPrompt: () => Promise<string>;
        }) => {
          registeredFooterPrompts.push(def);
        },
        registerConversationType: vi.fn(),
        registerTaskAssistant: vi.fn(),
        addToolToConversationType: vi.fn(),
        config: vi.fn(),
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
        offer: vi.fn(),
        request: vi.fn(),
      };
    },
  };
}

describe('datetimePlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;

  beforeEach(() => {
    mockInterface = createMockPluginInterface();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has correct plugin metadata', () => {
    expect(datetimePlugin.pluginMetadata).toEqual({
      id: 'datetime',
      name: 'Date and Time Plugin',
      brandColor: '#dfeaae',
      description: 'Provides the current date and time to the assistant.',
      version: 'LATEST',
      dependencies: [],
      required: true,
    });
  });

  it('registers a footer system prompt during initialization', async () => {
    await datetimePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    expect(mockInterface.registeredFooterPrompts).toHaveLength(1);
    expect(mockInterface.registeredFooterPrompts[0]).toMatchObject({
      name: 'datetimeFooter',
      weight: 99999,
    });
  });

  it('footer prompt includes current date and time in proper format', async () => {
    const currentDate = new Date('2024-03-15T14:30:45Z');
    vi.setSystemTime(currentDate);

    await datetimePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const registeredPrompt = mockInterface.registeredFooterPrompts[0];
    const promptText = await registeredPrompt.getPrompt();

    expect(promptText).toContain('## CURRENT DATE AND TIME');
    expect(promptText).toContain(format(currentDate, 'PPP pp'));
    expect(promptText).toContain(format(currentDate, 'EEEE'));
  });

  it('footer prompt includes day of week', async () => {
    // Set to Monday, January 1, 2024
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

    await datetimePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const registeredPrompt = mockInterface.registeredFooterPrompts[0];
    const promptText = await registeredPrompt.getPrompt();

    expect(promptText).toContain('Monday');
  });

  it('footer prompt updates with new system time', async () => {
    await datetimePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const registeredPrompt = mockInterface.registeredFooterPrompts[0];

    // First call
    const firstDate = new Date('2024-03-15T14:30:45Z');
    vi.setSystemTime(firstDate);
    let promptText = await registeredPrompt.getPrompt();
    expect(promptText).toContain(format(firstDate, 'PPP pp'));

    // Second call with different time - verify date changed
    const secondDate = new Date('2024-12-25T09:15:00Z');
    vi.setSystemTime(secondDate);
    promptText = await registeredPrompt.getPrompt();
    expect(promptText).toContain(format(secondDate, 'PPP pp'));
    expect(promptText).toContain(format(secondDate, 'EEEE'));
  });

  it('has high weight priority for footer prompt', async () => {
    await datetimePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    expect(mockInterface.registeredFooterPrompts[0].weight).toBe(99999);
  });

  it('registers exactly one footer prompt', async () => {
    await datetimePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    expect(mockInterface.registeredFooterPrompts).toHaveLength(1);
  });

  it('plugin is marked as required', () => {
    expect(datetimePlugin.pluginMetadata.required).toBe(true);
  });

  it('plugin has no dependencies', () => {
    expect(datetimePlugin.pluginMetadata.dependencies).toEqual([]);
  });
});
