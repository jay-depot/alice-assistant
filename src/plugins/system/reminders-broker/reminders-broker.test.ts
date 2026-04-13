/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** Drain the microtask queue by flushing several Promise resolution ticks. */
const flushMicrotasks = async (ticks = 12) => {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
};

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

type RemindersBrokerModule = typeof import('./reminders-broker.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ReminderInput = {
  reminderMessage: string;
  scheduledFor: Date;
  source: string;
};

/** Builds a lightweight MikroORM fake that tracks persisted RemindersSchedule rows. */
function createMockOrm(initialRows: any[] = []) {
  let nextId = 1;
  const rows: any[] = initialRows.map(r => ({ ...r }));

  const em = {
    fork: () => em,
    find: vi.fn(async (_entity: any, where: any) => {
      if (where.scheduledFor?.$lte) {
        return rows.filter(
          r => r.scheduledFor <= where.scheduledFor.$lte && !r._deleted
        );
      }
      return rows.filter(r => !r._deleted);
    }),
    findOne: vi.fn(async (_entity: any, where: any) => {
      return rows.find(r => r.id === where.id && !r._deleted) ?? null;
    }),
    create: vi.fn((_entity: any, data: any) => {
      const row = { ...data, id: nextId++ };
      rows.push(row);
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

function createMockPluginInterface(rows: any[] = []) {
  const offeredCapabilities: Record<string, any> = {};
  const hooks: Record<string, Array<(...args: any[]) => Promise<void>>> = {};
  const orm = createMockOrm(rows);

  // Resolved ORM for onDatabaseReady
  const mockMemoryApi = {
    registerDatabaseModels: vi.fn(),
    onDatabaseReady: vi.fn(async (cb: (orm: any) => Promise<any>) => cb(orm)),
    saveMemory: vi.fn(),
  };

  const mockSendNotification = vi.fn().mockResolvedValue(undefined);
  const mockNotificationsBrokerApi = {
    sendNotification: mockSendNotification,
    registerNotificationSink: vi.fn(),
  };

  return {
    offeredCapabilities,
    hooks,
    orm,
    sendNotification: mockSendNotification,
    runHook: async (name: string, ...args: any[]) => {
      for (const cb of hooks[name] ?? []) await cb(...args);
    },
    registerPlugin: async () => ({
      logger: {
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      registerTool: vi.fn(),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      config: vi.fn(),
      hooks: {
        onAllPluginsLoaded: vi.fn(),
        onAssistantWillAcceptRequests: vi.fn(),
        onAssistantAcceptsRequests: (cb: () => Promise<void>) =>
          (hooks.onAssistantAcceptsRequests ??= []).push(cb),
        onAssistantWillStopAcceptingRequests: (cb: () => Promise<void>) =>
          (hooks.onAssistantWillStopAcceptingRequests ??= []).push(cb),
        onAssistantStoppedAcceptingRequests: vi.fn(),
        onPluginsWillUnload: vi.fn(),
        onTaskAssistantWillBegin: vi.fn(),
        onTaskAssistantWillEnd: vi.fn(),
        onUserConversationWillBegin: vi.fn(),
        onUserConversationWillEnd: vi.fn(),
        onContextCompactionSummariesWillBeDeleted: vi.fn(),
      },
      offer: (caps: any) => (offeredCapabilities['reminders-broker'] = caps),
      request: (pluginId: string) => {
        if (pluginId === 'memory') return mockMemoryApi;
        if (pluginId === 'notifications-broker')
          return mockNotificationsBrokerApi;
        return undefined;
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('remindersBrokerPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;
  let remindersBrokerPlugin: RemindersBrokerModule['default'];

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const module = await import('./reminders-broker.js');
    remindersBrokerPlugin = module.default;
    mockInterface = createMockPluginInterface();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has correct plugin metadata', () => {
    expect(remindersBrokerPlugin.pluginMetadata).toMatchObject({
      id: 'reminders-broker',
      name: 'Reminders Broker Plugin',
      version: 'LATEST',
      required: true,
    });
  });

  it('declares dependencies on datetime, memory, and notifications-broker', () => {
    const depIds = remindersBrokerPlugin.pluginMetadata.dependencies!.map(
      d => d.id
    );
    expect(depIds).toContain('datetime');
    expect(depIds).toContain('memory');
    expect(depIds).toContain('notifications-broker');
  });

  it('offers reminders-broker capabilities', async () => {
    await remindersBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['reminders-broker'];
    expect(api).toHaveProperty('createNewReminder');
    expect(api).toHaveProperty('updateReminder');
    expect(api).toHaveProperty('deleteReminder');
  });

  it('createNewReminder persists a row and returns its id', async () => {
    await remindersBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['reminders-broker'];

    const id = await api.createNewReminder({
      reminderMessage: 'Buy milk',
      scheduledFor: new Date('2026-04-13T09:00:00Z'),
      source: 'test-plugin',
    } satisfies ReminderInput);

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
    // ORM em.flush was called
    expect(mockInterface.orm.em.flush).toHaveBeenCalled();
  });

  it('updateReminder changes stored fields', async () => {
    const futureDate = new Date('2026-12-01T12:00:00Z');
    mockInterface = createMockPluginInterface([
      {
        id: 1,
        reminderMessage: 'Old message',
        scheduledFor: futureDate,
        source: 'plugin-a',
      },
    ]);
    const module = await import('./reminders-broker.js');
    remindersBrokerPlugin = module.default;

    await remindersBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['reminders-broker'];

    await api.updateReminder('1', { reminderMessage: 'New message' });

    const row = mockInterface.orm.rows.find((r: any) => r.id === 1);
    expect(row.reminderMessage).toBe('New message');
    expect(mockInterface.orm.em.flush).toHaveBeenCalled();
  });

  it('updateReminder throws when id is not found', async () => {
    await remindersBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['reminders-broker'];

    await expect(
      api.updateReminder('999', { reminderMessage: 'Ghost' })
    ).rejects.toThrow(/999/);
  });

  it('deleteReminder removes the row', async () => {
    const futureDate = new Date('2026-12-01T12:00:00Z');
    mockInterface = createMockPluginInterface([
      {
        id: 1,
        reminderMessage: 'Delete me',
        scheduledFor: futureDate,
        source: 'plugin-a',
      },
    ]);
    const module = await import('./reminders-broker.js');
    remindersBrokerPlugin = module.default;

    await remindersBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['reminders-broker'];

    await api.deleteReminder('1');

    const row = mockInterface.orm.rows.find((r: any) => r.id === 1);
    expect(row._deleted).toBe(true);
    expect(mockInterface.orm.em.flush).toHaveBeenCalled();
  });

  it('deleteReminder throws when id is not found', async () => {
    await remindersBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['reminders-broker'];

    await expect(api.deleteReminder('42')).rejects.toThrow(/42/);
  });

  it('onAssistantAcceptsRequests fires a startup polling cycle', async () => {
    const pastDate = new Date('2020-01-01T00:00:00Z');
    mockInterface = createMockPluginInterface([
      {
        id: 1,
        reminderMessage: 'Old reminder',
        scheduledFor: pastDate,
        source: 'plugin',
      },
    ]);
    const module = await import('./reminders-broker.js');
    remindersBrokerPlugin = module.default;

    await remindersBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    await mockInterface.runHook('onAssistantAcceptsRequests');
    // The startup cycle is launched with `void` — flush the microtask queue
    await flushMicrotasks();

    expect(mockInterface.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Old reminder' })
    );
  });

  it('does not dispatch reminders scheduled in the future', async () => {
    const futureDate = new Date('2099-01-01T00:00:00Z');
    mockInterface = createMockPluginInterface([
      {
        id: 1,
        reminderMessage: 'Future',
        scheduledFor: futureDate,
        source: 'plugin',
      },
    ]);
    const module = await import('./reminders-broker.js');
    remindersBrokerPlugin = module.default;

    await remindersBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    await mockInterface.runHook('onAssistantAcceptsRequests');
    await flushMicrotasks();

    expect(mockInterface.sendNotification).not.toHaveBeenCalled();
  });

  it('onAssistantWillStopAcceptingRequests clears the polling interval', async () => {
    await remindersBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    await mockInterface.runHook('onAssistantAcceptsRequests');
    await flushMicrotasks();

    await mockInterface.runHook('onAssistantWillStopAcceptingRequests');
    await flushMicrotasks();

    expect(clearIntervalSpy).toHaveBeenCalled();

    // Advancing timers past a polling cycle should not trigger more notifications
    vi.advanceTimersByTime(65_000);
    await flushMicrotasks();
    expect(mockInterface.sendNotification).not.toHaveBeenCalled();
  });
});
