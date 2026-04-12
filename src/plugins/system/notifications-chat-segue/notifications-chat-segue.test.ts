/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';

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
import notificationsChatSeguePlugin from './notifications-chat-segue.js';

type NotificationRow = {
  id: number;
  title: string;
  message: string;
  source: string;
  status: 'pending' | 'delivered';
  createdAt: Date;
  updatedAt: Date;
};

function createMockPluginInterface(
  initialRows: Partial<NotificationRow>[] = []
) {
  let nextId = 1;
  const rows: NotificationRow[] = initialRows.map(row => ({
    id: nextId++,
    title: '',
    message: '',
    source: '',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...row,
  }));

  const em = {
    fork: () => em,
    create: vi.fn((_entity: any, data: any) => {
      const row = {
        id: nextId++,
        ...data,
      } as NotificationRow;
      rows.push(row);
      return row;
    }),
    persist: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(async (_entity: any, where: any) => {
      let filtered = rows.filter(row => {
        if (where?.status && row.status !== where.status) return false;
        if (where?.id?.$in && !where.id.$in.includes(row.id)) return false;
        return true;
      });
      if (where?.status === 'pending') {
        filtered = filtered.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
        );
      }
      return filtered;
    }),
  };

  const orm = { em };
  const registerNotificationSink = vi.fn().mockResolvedValue(undefined);
  const registerDatabaseModels = vi.fn();
  const headerPrompts: any[] = [];
  const tools: any[] = [];

  return {
    rows,
    em,
    registerNotificationSink,
    registerDatabaseModels,
    headerPrompts,
    tools,
    registerPlugin: async () => ({
      request: (pluginId: string) => {
        if (pluginId === 'notifications-broker') {
          return { registerNotificationSink };
        }
        if (pluginId === 'memory') {
          return {
            registerDatabaseModels,
            onDatabaseReady: async (cb: (databaseOrm: any) => Promise<any>) =>
              cb(orm),
          };
        }
        return undefined;
      },
      registerHeaderSystemPrompt: (prompt: any) => headerPrompts.push(prompt),
      registerTool: (tool: any) => tools.push(tool),
      registerFooterSystemPrompt: vi.fn(),
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

describe('notificationsChatSeguePlugin', () => {
  it('has correct plugin metadata and dependencies', () => {
    expect(notificationsChatSeguePlugin.pluginMetadata).toMatchObject({
      id: 'notifications-chat-segue',
      name: 'Notifications Chat Segue Plugin',
      version: 'LATEST',
      required: false,
    });

    const depIds =
      notificationsChatSeguePlugin.pluginMetadata.dependencies!.map(d => d.id);
    expect(depIds).toContain('notifications-broker');
    expect(depIds).toContain('memory');
  });

  it('registers DB models and notification sink', async () => {
    const mockInterface = createMockPluginInterface();
    await notificationsChatSeguePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    expect(mockInterface.registerDatabaseModels).toHaveBeenCalledTimes(1);
    expect(mockInterface.registerNotificationSink).toHaveBeenCalledWith(
      'notifications-chat-segue',
      expect.objectContaining({ sendNotification: expect.any(Function) })
    );
  });

  it('sink sendNotification persists a pending notification row', async () => {
    const mockInterface = createMockPluginInterface();
    await notificationsChatSeguePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const sink = mockInterface.registerNotificationSink.mock.calls[0][1] as {
      sendNotification: (notification: {
        title: string;
        message: string;
        source: string;
      }) => Promise<void>;
    };

    await sink.sendNotification({
      title: 'Reminder',
      message: 'Water your plants',
      source: 'reminders-broker',
    });

    expect(mockInterface.rows).toHaveLength(1);
    expect(mockInterface.rows[0]).toMatchObject({
      title: 'Reminder',
      message: 'Water your plants',
      source: 'reminders-broker',
      status: 'pending',
    });
  });

  it('header prompt returns false for non-chat conversation types', async () => {
    const mockInterface = createMockPluginInterface();
    await notificationsChatSeguePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const header = mockInterface.headerPrompts[0];
    const result = await header.getPrompt({ conversationType: 'voice' });
    expect(result).toBe(false);
  });

  it('header prompt returns false when there are no pending notifications', async () => {
    const mockInterface = createMockPluginInterface();
    await notificationsChatSeguePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const header = mockInterface.headerPrompts[0];
    const result = await header.getPrompt({ conversationType: 'chat' });
    expect(result).toBe(false);
  });

  it('header prompt lists pending notifications for chat', async () => {
    const now = new Date('2026-04-12T00:00:00Z');
    const mockInterface = createMockPluginInterface([
      {
        id: 1,
        title: 'Appt',
        message: 'Dentist tomorrow',
        source: 'appointments',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await notificationsChatSeguePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const header = mockInterface.headerPrompts[0];
    const result = await header.getPrompt({ conversationType: 'chat' });

    expect(result).toContain('# PENDING NOTIFICATIONS');
    expect(result).toContain('ID 1');
    expect(result).toContain('Appt');
    expect(result).toContain('Dentist tomorrow');
  });

  it('registers markNotificationsDelivered tool for chat', async () => {
    const mockInterface = createMockPluginInterface();
    await notificationsChatSeguePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.tools.find(
      toolDef => toolDef.name === 'markNotificationsDelivered'
    );

    expect(tool).toBeDefined();
    expect(tool.availableFor).toEqual(['chat']);
  });

  it('markNotificationsDelivered handles missing IDs', async () => {
    const mockInterface = createMockPluginInterface();
    await notificationsChatSeguePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.tools.find(
      toolDef => toolDef.name === 'markNotificationsDelivered'
    );
    const result = await tool.execute({ notificationIds: [] });

    expect(result).toMatch(/No notification IDs were provided/i);
  });

  it('markNotificationsDelivered handles non-integer IDs', async () => {
    const mockInterface = createMockPluginInterface();
    await notificationsChatSeguePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.tools.find(
      toolDef => toolDef.name === 'markNotificationsDelivered'
    );
    const result = await tool.execute({ notificationIds: ['foo', 'bar'] });

    expect(result).toMatch(/valid integers/i);
  });

  it('markNotificationsDelivered returns no-match message when IDs do not match pending rows', async () => {
    const now = new Date('2026-04-12T00:00:00Z');
    const mockInterface = createMockPluginInterface([
      {
        id: 9,
        title: 'Done',
        message: 'Already delivered',
        source: 'test',
        status: 'delivered',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await notificationsChatSeguePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.tools.find(
      toolDef => toolDef.name === 'markNotificationsDelivered'
    );
    const result = await tool.execute({ notificationIds: ['9'] });

    expect(result).toMatch(/No pending notifications matched/i);
  });

  it('markNotificationsDelivered updates status and returns summary', async () => {
    const now = new Date('2026-04-12T00:00:00Z');
    const mockInterface = createMockPluginInterface([
      {
        id: 2,
        title: 'Hydrate',
        message: 'Drink water',
        source: 'wellbeing',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 3,
        title: 'Stretch',
        message: 'Take a stretch break',
        source: 'wellbeing',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await notificationsChatSeguePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.tools.find(
      toolDef => toolDef.name === 'markNotificationsDelivered'
    );
    const result = await tool.execute({ notificationIds: ['2', '3'] });

    expect(mockInterface.rows[0].status).toBe('delivered');
    expect(mockInterface.rows[1].status).toBe('delivered');
    expect(mockInterface.em.flush).toHaveBeenCalled();
    expect(result).toMatch(/Marked 2 notification\(s\) as delivered: 2, 3/);
  });
});
