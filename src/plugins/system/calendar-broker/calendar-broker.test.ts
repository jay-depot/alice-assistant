/**
 * @file calendar-broker.test.ts
 *
 * Unit tests for the calendar-broker plugin.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import calendarBrokerPlugin from './calendar-broker.js';

function createMockPluginInterface(
  defaultProvider?: string,
  defaultTimeZone?: string
) {
  const offeredCapabilities: Record<string, any> = {};
  const registeredTools: any[] = [];
  const mockLogger = {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    offeredCapabilities,
    registeredTools,
    mockLogger,
    registerPlugin: async () => ({
      logger: mockLogger,
      registerTool: (tool: any) => registeredTools.push(tool),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      request: vi.fn(),
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
      offer: (caps: any) => {
        offeredCapabilities['calendar-broker'] = caps;
      },
      config: vi.fn().mockResolvedValue({
        getPluginConfig: () => ({ defaultProvider, defaultTimeZone }),
      }),
    }),
  };
}

type CalendarApi = {
  registerCalendarProvider: (name: string, provider: any) => void;
  requestCalendarEvents: (params: any) => Promise<Record<string, any[]>>;
  requestCalendarEventCreate: (params: any) => Promise<Record<string, any>>;
  requestCalendarEventUpdate: (params: any) => Promise<Record<string, any>>;
};

describe('calendarBrokerPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;
  let api: CalendarApi;

  beforeEach(async () => {
    mockInterface = createMockPluginInterface();
    await calendarBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    api = mockInterface.offeredCapabilities['calendar-broker'];
  });

  it('has correct plugin metadata', () => {
    expect(calendarBrokerPlugin.pluginMetadata).toMatchObject({
      id: 'calendar-broker',
      name: 'Calendar Broker Plugin',
      version: 'LATEST',
      required: false,
    });
  });

  it('offers registerCalendarProvider, requestCalendarEvents, requestCalendarEventCreate, requestCalendarEventUpdate', () => {
    expect(typeof api.registerCalendarProvider).toBe('function');
    expect(typeof api.requestCalendarEvents).toBe('function');
    expect(typeof api.requestCalendarEventCreate).toBe('function');
    expect(typeof api.requestCalendarEventUpdate).toBe('function');
  });

  it('registers getCalendarEvents, createCalendarEvent, and updateCalendarEvent tools', () => {
    const toolNames = mockInterface.registeredTools.map((t: any) => t.name);
    expect(toolNames).toContain('getCalendarEvents');
    expect(toolNames).toContain('createCalendarEvent');
    expect(toolNames).toContain('updateCalendarEvent');
  });

  it('all tools have tainted status', () => {
    for (const tool of mockInterface.registeredTools) {
      expect(tool.taintStatus).toBe('tainted');
    }
  });

  it('all tools are available for chat, voice, and autonomy', () => {
    for (const tool of mockInterface.registeredTools) {
      expect(tool.availableFor).toContain('chat');
      expect(tool.availableFor).toContain('voice');
      expect(tool.availableFor).toContain('autonomy');
    }
  });

  it('createCalendarEvent tool has user-confirmation instruction in systemPromptFragment', () => {
    const createTool = mockInterface.registeredTools.find(
      (t: any) => t.name === 'createCalendarEvent'
    );
    expect(createTool).toBeDefined();
    expect(createTool!.systemPromptFragment).toContain('confirm');
  });

  it('updateCalendarEvent tool has user-confirmation instruction in systemPromptFragment', () => {
    const updateTool = mockInterface.registeredTools.find(
      (t: any) => t.name === 'updateCalendarEvent'
    );
    expect(updateTool).toBeDefined();
    expect(updateTool!.systemPromptFragment).toContain('confirm');
  });

  describe('requestCalendarEvents', () => {
    it('returns empty object when no providers registered', async () => {
      const result = await api.requestCalendarEvents({
        timeMin: '2024-01-01T00:00:00Z',
      });
      expect(result).toEqual({});
    });

    it('calls all providers and merges results', async () => {
      const event1 = {
        id: 'ev1',
        title: 'Meeting 1',
        description: undefined,
        start: {
          dateTime: '2024-01-15T10:00:00Z',
          timeZone: 'America/New_York',
        },
        end: { dateTime: '2024-01-15T11:00:00Z', timeZone: 'America/New_York' },
        location: 'Room A',
        attendees: undefined,
        isRecurring: false,
        recurrenceRule: undefined,
        reminders: undefined,
        status: 'confirmed',
        providerId: 'google-calendar:personal',
      };

      const provider = {
        getEvents: vi.fn().mockResolvedValue([event1]),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
      };

      api.registerCalendarProvider('google-calendar:personal', provider);

      const result = await api.requestCalendarEvents({
        timeMin: '2024-01-15T00:00:00Z',
        timeMax: '2024-01-22T00:00:00Z',
      });

      expect(provider.getEvents).toHaveBeenCalledWith({
        timeMin: '2024-01-15T00:00:00Z',
        timeMax: '2024-01-22T00:00:00Z',
      });
      expect(result['google-calendar:personal']).toHaveLength(1);
    });

    it('gracefully handles provider failures', async () => {
      const provider1 = {
        getEvents: vi.fn().mockRejectedValue(new Error('API error')),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
      };
      const provider2 = {
        getEvents: vi.fn().mockResolvedValue([]),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
      };

      api.registerCalendarProvider('fail-prov', provider1);
      api.registerCalendarProvider('ok-prov', provider2);

      const result = await api.requestCalendarEvents({});
      expect(Object.keys(result)).not.toContain('fail-prov');
      expect(Object.keys(result)).toContain('ok-prov');
    });
  });

  describe('requestCalendarEventCreate', () => {
    it('returns empty object when no providers registered', async () => {
      const result = await api.requestCalendarEventCreate({
        title: 'Test',
        start: { dateTime: '2024-01-15T10:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2024-01-15T11:00:00Z', timeZone: 'UTC' },
      });
      expect(result).toEqual({});
    });

    it('creates event via the first provider when no provider is specified', async () => {
      const provider = {
        getEvents: vi.fn(),
        createEvent: vi.fn().mockResolvedValue({
          provider: 'google-calendar:personal',
          success: true,
          message: 'Event created',
          eventId: 'ev123',
        }),
        updateEvent: vi.fn(),
      };

      api.registerCalendarProvider('google-calendar:personal', provider);

      const params = {
        title: 'Team Meeting',
        start: {
          dateTime: '2024-01-15T10:00:00Z',
          timeZone: 'America/New_York',
        },
        end: { dateTime: '2024-01-15T11:00:00Z', timeZone: 'America/New_York' },
      };

      const result = await api.requestCalendarEventCreate(params);
      expect(provider.createEvent).toHaveBeenCalledWith(params);
      expect(result['google-calendar:personal']).toBeDefined();
      expect(result['google-calendar:personal'].success).toBe(true);
    });

    it('creates event via the specified provider', async () => {
      const provider1 = {
        getEvents: vi.fn(),
        createEvent: vi.fn().mockResolvedValue({
          provider: 'gc:personal',
          success: true,
          message: 'Created',
          eventId: 'ev1',
        }),
        updateEvent: vi.fn(),
      };
      const provider2 = {
        getEvents: vi.fn(),
        createEvent: vi.fn().mockResolvedValue({
          provider: 'gc:work',
          success: true,
          message: 'Created',
          eventId: 'ev2',
        }),
        updateEvent: vi.fn(),
      };

      api.registerCalendarProvider('gc:personal', provider1);
      api.registerCalendarProvider('gc:work', provider2);

      const params = {
        title: 'Work Meeting',
        start: { dateTime: '2024-01-15T14:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2024-01-15T15:00:00Z', timeZone: 'UTC' },
        provider: 'gc:work',
      };

      const result = await api.requestCalendarEventCreate(params);
      expect(provider2.createEvent).toHaveBeenCalled();
      expect(result['gc:work']).toBeDefined();
    });
  });

  describe('requestCalendarEventUpdate', () => {
    it('returns empty object when no providers registered', async () => {
      const result = await api.requestCalendarEventUpdate({ eventId: 'ev1' });
      expect(result).toEqual({});
    });

    it('uses the specified provider when provider is specified', async () => {
      const provider = {
        getEvents: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn().mockResolvedValue({
          provider: 'gc:personal',
          success: true,
          message: 'Updated',
          eventId: 'ev1',
        }),
      };

      api.registerCalendarProvider('gc:personal', provider);

      const result = await api.requestCalendarEventUpdate({
        eventId: 'ev1',
        provider: 'gc:personal',
        title: 'New Title',
      });

      expect(provider.updateEvent).toHaveBeenCalledWith({
        eventId: 'ev1',
        provider: 'gc:personal',
        title: 'New Title',
      });
      expect(result['gc:personal']).toBeDefined();
    });

    it('tries all providers when no provider is specified', async () => {
      const provider1 = {
        getEvents: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn().mockResolvedValue({
          provider: 'gc:personal',
          success: false,
          message: 'Event not found',
        }),
      };
      const provider2 = {
        getEvents: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn().mockResolvedValue({
          provider: 'gc:work',
          success: true,
          message: 'Updated',
          eventId: 'ev1',
        }),
      };

      api.registerCalendarProvider('gc:personal', provider1);
      api.registerCalendarProvider('gc:work', provider2);

      await api.requestCalendarEventUpdate({
        eventId: 'ev1',
        title: 'Updated',
      });

      expect(provider1.updateEvent).toHaveBeenCalled();
      expect(provider2.updateEvent).toHaveBeenCalled();
    });
  });

  describe('LLM tool execution', () => {
    describe('getCalendarEvents tool', () => {
      it('returns no-providers message when no providers registered', async () => {
        const eventsTool = mockInterface.registeredTools.find(
          (t: any) => t.name === 'getCalendarEvents'
        );
        const result = await eventsTool.execute({
          timeMin: '2024-01-01T00:00:00Z',
        });
        expect(result).toContain('No calendar providers');
      });
    });

    describe('createCalendarEvent tool', () => {
      it('returns no-providers message when no providers registered', async () => {
        const createTool = mockInterface.registeredTools.find(
          (t: any) => t.name === 'createCalendarEvent'
        );
        const result = await createTool.execute({
          title: 'Test',
          startDateTime: '2024-01-15T10:00:00Z',
          startTimeZone: 'UTC',
          endDateTime: '2024-01-15T11:00:00Z',
          endTimeZone: 'UTC',
        });
        expect(result).toContain('No calendar providers');
      });
    });

    describe('updateCalendarEvent tool', () => {
      it('returns no-providers message when no providers registered', async () => {
        const updateTool = mockInterface.registeredTools.find(
          (t: any) => t.name === 'updateCalendarEvent'
        );
        const result = await updateTool.execute({ eventId: 'ev1' });
        expect(result).toContain('No calendar providers');
      });
    });
  });

  describe('registerCalendarProvider with same name overrides previous', () => {
    it('should replace the previous provider when registering with the same name', async () => {
      const first = {
        getEvents: vi.fn().mockResolvedValue([
          {
            id: 'old',
            title: 'Old',
            start: { dateTime: '2024-01-01T10:00:00Z', timeZone: 'UTC' },
            end: { dateTime: '2024-01-01T11:00:00Z', timeZone: 'UTC' },
            status: 'confirmed',
            providerId: 'gc:personal',
            isRecurring: false,
          },
        ]),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
      };
      const second = {
        getEvents: vi.fn().mockResolvedValue([
          {
            id: 'new',
            title: 'New',
            start: { dateTime: '2024-01-01T10:00:00Z', timeZone: 'UTC' },
            end: { dateTime: '2024-01-01T11:00:00Z', timeZone: 'UTC' },
            status: 'confirmed',
            providerId: 'gc:personal',
            isRecurring: false,
          },
        ]),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
      };

      api.registerCalendarProvider('same', first);
      api.registerCalendarProvider('same', second);

      const result = await api.requestCalendarEvents({});
      expect(first.getEvents).not.toHaveBeenCalled();
      expect(second.getEvents).toHaveBeenCalledOnce();
      expect(result['same'][0].title).toBe('New');
    });
  });
});
