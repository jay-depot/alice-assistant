import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
import notificationsConsolePlugin from './notifications-console.js';

function createMockPluginInterface() {
  const registerNotificationSink = vi.fn().mockResolvedValue(undefined);
  const logger = {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    registerNotificationSink,
    logger,
    registerPlugin: async () => ({
      logger,
      request: (pluginId: string) => {
        if (pluginId === 'notifications-broker') {
          return { registerNotificationSink };
        }
        return undefined;
      },
      registerTool: vi.fn(),
      registerHeaderSystemPrompt: vi.fn(),
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

describe('notificationsConsolePlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('has correct plugin metadata', () => {
    expect(notificationsConsolePlugin.pluginMetadata).toMatchObject({
      id: 'notifications-console',
      name: 'Notifications Console Plugin',
      version: 'LATEST',
      required: false,
    });
  });

  it('declares dependency on notifications-broker', () => {
    const depIds = notificationsConsolePlugin.pluginMetadata.dependencies!.map(
      d => d.id
    );
    expect(depIds).toContain('notifications-broker');
  });

  it('registers notifications-console sink with notifications-broker', async () => {
    const mockInterface = createMockPluginInterface();
    await notificationsConsolePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    expect(mockInterface.registerNotificationSink).toHaveBeenCalledOnce();
    expect(mockInterface.registerNotificationSink).toHaveBeenCalledWith(
      'notifications-console',
      expect.objectContaining({ sendNotification: expect.any(Function) })
    );
  });

  it('registered sink logs notification fields to console', async () => {
    const mockInterface = createMockPluginInterface();
    await notificationsConsolePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const sink = mockInterface.registerNotificationSink.mock.calls[0][1] as {
      sendNotification: (notification: {
        title: string;
        source: string;
        message: string;
      }) => Promise<void>;
    };

    await sink.sendNotification({
      title: 'Meeting Reminder',
      source: 'reminders-broker',
      message: 'Standup in 10 minutes',
    });

    expect(mockInterface.logger.log).toHaveBeenCalledWith('ALICE Notification');
    expect(mockInterface.logger.log).toHaveBeenCalledWith(
      '  Title: Meeting Reminder'
    );
    expect(mockInterface.logger.log).toHaveBeenCalledWith(
      '  Source: reminders-broker'
    );
    expect(mockInterface.logger.log).toHaveBeenCalledWith(
      '  Message: Standup in 10 minutes'
    );
  });
});
