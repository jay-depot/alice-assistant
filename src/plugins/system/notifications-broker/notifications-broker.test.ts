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
import notificationsBrokerPlugin from './notifications-broker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type NotificationPayload = { title: string; message: string; source: string };

function createMockPluginInterface() {
  const offeredCapabilities: Record<string, any> = {};

  return {
    offeredCapabilities,
    registerPlugin: async () => ({
      registerTool: vi.fn(),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      addToolToConversationType: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      config: vi.fn(),
      request: vi.fn(),
      offer: (caps: any) => {
        offeredCapabilities['notifications-broker'] = caps;
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

describe('notificationsBrokerPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;
  let api: {
    sendNotification: (n: NotificationPayload) => Promise<void>;
    registerNotificationSink: (
      name: string,
      sink: { sendNotification: (n: NotificationPayload) => Promise<void> }
    ) => Promise<void>;
  };

  beforeEach(async () => {
    mockInterface = createMockPluginInterface();
    await notificationsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    api = mockInterface.offeredCapabilities['notifications-broker'];
  });

  it('has correct plugin metadata', () => {
    expect(notificationsBrokerPlugin.pluginMetadata).toMatchObject({
      id: 'notifications-broker',
      name: 'Notifications Broker Plugin',
      version: 'LATEST',
      required: true,
    });
  });

  it('has no plugin dependencies', () => {
    expect(notificationsBrokerPlugin.pluginMetadata.dependencies).toEqual([]);
  });

  it('offers sendNotification and registerNotificationSink', () => {
    expect(typeof api.sendNotification).toBe('function');
    expect(typeof api.registerNotificationSink).toBe('function');
  });

  it('sendNotification with no sinks registered resolves without throwing', async () => {
    await expect(
      api.sendNotification({ title: 'Hello', message: 'World', source: 'test' })
    ).resolves.toBeUndefined();
  });

  it('sendNotification dispatches the full payload to a registered sink', async () => {
    const sink = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    await api.registerNotificationSink('test-sink', sink);

    const payload: NotificationPayload = {
      title: 'Reminder',
      message: 'Take a break.',
      source: 'reminders-broker',
    };
    await api.sendNotification(payload);

    expect(sink.sendNotification).toHaveBeenCalledOnce();
    expect(sink.sendNotification).toHaveBeenCalledWith(payload);
  });

  it('sendNotification dispatches to all registered sinks', async () => {
    const sinkA = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    const sinkB = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    await api.registerNotificationSink('sink-a', sinkA);
    await api.registerNotificationSink('sink-b', sinkB);

    await api.sendNotification({
      title: 'T',
      message: 'M',
      source: 'S',
    });

    expect(sinkA.sendNotification).toHaveBeenCalledOnce();
    expect(sinkB.sendNotification).toHaveBeenCalledOnce();
  });

  it('registering a second sink with the same name replaces the first', async () => {
    const sinkA = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    const sinkB = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    await api.registerNotificationSink('same-name', sinkA);
    await api.registerNotificationSink('same-name', sinkB);

    await api.sendNotification({ title: 'T', message: 'M', source: 'S' });

    expect(sinkA.sendNotification).not.toHaveBeenCalled();
    expect(sinkB.sendNotification).toHaveBeenCalledOnce();
  });

  it('sendNotification rejects when a sink throws', async () => {
    const brokeSink = {
      sendNotification: vi.fn().mockRejectedValue(new Error('sink exploded')),
    };
    await api.registerNotificationSink('broke-sink', brokeSink);

    await expect(
      api.sendNotification({ title: 'T', message: 'M', source: 'S' })
    ).rejects.toThrow('sink exploded');
  });

  it('a healthy sink still receives the notification even when another sink is added later', async () => {
    const sinkA = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    await api.registerNotificationSink('a', sinkA);

    const sinkB = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    await api.registerNotificationSink('b', sinkB);

    await api.sendNotification({ title: 'T', message: 'M', source: 'S' });

    expect(sinkA.sendNotification).toHaveBeenCalledOnce();
    expect(sinkB.sendNotification).toHaveBeenCalledOnce();
  });
});
