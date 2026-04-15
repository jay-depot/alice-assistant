/**
 * @file google-calendar.test.ts
 *
 * Unit tests for the google-calendar provider plugin.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';

// Mock the plugin-hooks module to break circular dependencies
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

// Mock external Google APIs
vi.mock('@googleapis/calendar', () => ({
  calendar: vi.fn(),
}));
vi.mock('google-auth-library', () => {
  class MockOAuth2Client {
    setCredentials = vi.fn();
    generateAuthUrl = vi
      .fn()
      .mockReturnValue('https://accounts.google.com/oauth');
    getToken = vi.fn().mockResolvedValue({
      tokens: { access_token: 'mock', refresh_token: 'mock_refresh' },
    });
    revokeToken = vi.fn().mockResolvedValue(undefined);
    getAccessToken = vi.fn().mockResolvedValue({ token: 'mock_access' });
    on = vi.fn();
  }
  return { OAuth2Client: MockOAuth2Client };
});

import type { AlicePluginInterface } from '../../../lib.js';
import googleCalendarPlugin from './google-calendar.js';

function createMockPluginInterface(
  googleApisCapability: Record<string, any> | null,
  calendarBrokerCapability: Record<string, any> | null
) {
  let capturedAllPluginsLoaded: (() => Promise<void>) | null = null;
  const mockLogger = {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    mockLogger,
    getCapturedHook: () => capturedAllPluginsLoaded,
    registerPlugin: async () => ({
      logger: mockLogger,
      registerTool: vi.fn(),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      hooks: {
        onAllPluginsLoaded: vi.fn((cb: () => Promise<void>) => {
          capturedAllPluginsLoaded = cb;
        }),
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
      config: vi.fn().mockResolvedValue({
        getPluginConfig: () => ({
          defaultCalendarId: 'primary',
          maxResultsPerQuery: 25,
        }),
      }),
      offer: vi.fn(),
      request: vi.fn((capabilityId: string) => {
        if (capabilityId === 'google-apis') return googleApisCapability;
        if (capabilityId === 'calendar-broker') return calendarBrokerCapability;
        return null;
      }),
    }),
  };
}

describe('googleCalendarPlugin', () => {
  describe('plugin metadata', () => {
    it('should have the correct plugin metadata', () => {
      expect(googleCalendarPlugin.pluginMetadata.id).toBe('google-calendar');
      expect(googleCalendarPlugin.pluginMetadata.name).toBe(
        'Google Calendar Plugin'
      );
      expect(googleCalendarPlugin.pluginMetadata.required).toBe(false);
      expect(googleCalendarPlugin.pluginMetadata.dependencies).toEqual([
        { id: 'google-apis', version: 'LATEST' },
        { id: 'calendar-broker', version: 'LATEST' },
      ]);
    });
  });

  describe('provider registration', () => {
    it('should register as a calendar provider when google-apis has an authenticated account', async () => {
      const googleApisCapability = {
        listAccounts: vi.fn().mockReturnValue(['personal']),
        getAccountInfo: vi.fn().mockReturnValue({
          accountId: 'personal',
          email: 'test@gmail.com',
          isAuthenticated: true,
        }),
        getCalendarClient: vi.fn().mockResolvedValue({
          events: { list: vi.fn(), insert: vi.fn(), patch: vi.fn() },
        }),
      };

      const calendarBrokerCapability = {
        registerCalendarProvider: vi.fn(),
      };

      const mockInterface = createMockPluginInterface(
        googleApisCapability,
        calendarBrokerCapability
      );
      await googleCalendarPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      // Trigger onAllPluginsLoaded
      const hook = mockInterface.getCapturedHook();
      expect(hook).toBeDefined();
      await hook!();

      expect(
        calendarBrokerCapability.registerCalendarProvider
      ).toHaveBeenCalledWith(
        'google-calendar:personal',
        expect.objectContaining({
          getEvents: expect.any(Function),
          createEvent: expect.any(Function),
          updateEvent: expect.any(Function),
        })
      );
    });

    it('should skip unauthenticated accounts', async () => {
      const googleApisCapability = {
        listAccounts: vi.fn().mockReturnValue(['personal', 'work']),
        getAccountInfo: vi.fn().mockImplementation((id: string) => {
          if (id === 'personal')
            return { accountId: 'personal', isAuthenticated: true };
          return { accountId: 'work', isAuthenticated: false };
        }),
        getCalendarClient: vi.fn().mockResolvedValue({}),
      };

      const calendarBrokerCapability = {
        registerCalendarProvider: vi.fn(),
      };

      const mockInterface = createMockPluginInterface(
        googleApisCapability,
        calendarBrokerCapability
      );
      await googleCalendarPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      await mockInterface.getCapturedHook()!();

      expect(
        calendarBrokerCapability.registerCalendarProvider
      ).toHaveBeenCalledTimes(1);
      expect(
        calendarBrokerCapability.registerCalendarProvider
      ).toHaveBeenCalledWith('google-calendar:personal', expect.any(Object));
    });

    it('should warn when no Google accounts are connected', async () => {
      const googleApisCapability = {
        listAccounts: vi.fn().mockReturnValue([]),
      };

      const calendarBrokerCapability = {
        registerCalendarProvider: vi.fn(),
      };

      const mockInterface = createMockPluginInterface(
        googleApisCapability,
        calendarBrokerCapability
      );
      await googleCalendarPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      await mockInterface.getCapturedHook()!();

      expect(
        calendarBrokerCapability.registerCalendarProvider
      ).not.toHaveBeenCalled();
      expect(mockInterface.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No Google accounts')
      );
    });

    it('should error when google-apis capability is not available', async () => {
      const calendarBrokerCapability = {
        registerCalendarProvider: vi.fn(),
      };

      const mockInterface = createMockPluginInterface(
        null,
        calendarBrokerCapability
      );
      await googleCalendarPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      expect(mockInterface.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('google-apis capability not available')
      );
    });

    it('should error when calendar-broker capability is not available', async () => {
      const googleApisCapability = {
        listAccounts: vi.fn().mockReturnValue([]),
      };

      const mockInterface = createMockPluginInterface(
        googleApisCapability,
        null
      );
      await googleCalendarPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      expect(mockInterface.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('calendar-broker capability not available')
      );
    });

    it('should register separate providers for each authenticated account', async () => {
      const googleApisCapability = {
        listAccounts: vi.fn().mockReturnValue(['personal', 'work']),
        getAccountInfo: vi.fn().mockImplementation((id: string) => ({
          accountId: id,
          email: `${id}@gmail.com`,
          isAuthenticated: true,
        })),
        getCalendarClient: vi.fn().mockResolvedValue({}),
      };

      const calendarBrokerCapability = {
        registerCalendarProvider: vi.fn(),
      };

      const mockInterface = createMockPluginInterface(
        googleApisCapability,
        calendarBrokerCapability
      );
      await googleCalendarPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      await mockInterface.getCapturedHook()!();

      expect(
        calendarBrokerCapability.registerCalendarProvider
      ).toHaveBeenCalledTimes(2);
      expect(
        calendarBrokerCapability.registerCalendarProvider
      ).toHaveBeenCalledWith('google-calendar:personal', expect.any(Object));
      expect(
        calendarBrokerCapability.registerCalendarProvider
      ).toHaveBeenCalledWith('google-calendar:work', expect.any(Object));
    });
  });
});
