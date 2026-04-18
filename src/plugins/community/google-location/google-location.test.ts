/**
 * @file google-location.test.ts
 *
 * Unit tests for the google-location plugin.
 */

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LocationData = {
  coordinates?: { latitude: number; longitude: number };
  localityName?: string;
  regionName?: string;
  countryName?: string;
};

function createMockPluginInterface(
  listAccountsResult: string[] = [],
  getAccountInfoResult: Record<
    string,
    { accountId: string; isAuthenticated: boolean; email?: string }
  > = {},
  preferredAccount = ''
) {
  let registeredProviderId: string | null = null;
  let registeredProviderFn: (() => Promise<LocationData>) | null = null;
  let onAllPluginsLoadedCallback: (() => Promise<void>) | null = null;

  const mockGoogleApis = {
    getAuthenticatedClient: vi.fn().mockResolvedValue(null),
    getGmailClient: vi.fn().mockResolvedValue(null),
    getCalendarClient: vi.fn().mockResolvedValue(null),
    getPeopleClient: vi.fn().mockResolvedValue(null),
    listAccounts: vi.fn().mockReturnValue(listAccountsResult),
    getAccountInfo: vi
      .fn()
      .mockImplementation(
        (accountId: string) => getAccountInfoResult[accountId] ?? null
      ),
    initiateOAuthFlow: vi.fn().mockResolvedValue('https://mock-consent-url'),
    disconnectAccount: vi.fn().mockResolvedValue(undefined),
  };

  const mockLocationBroker = {
    registerLocationProvider: (id: string, fn: () => Promise<LocationData>) => {
      registeredProviderId = id;
      registeredProviderFn = fn;
    },
    requestLocationData: vi.fn(),
  };

  return {
    getRegisteredProvider: () => ({
      id: registeredProviderId,
      fn: registeredProviderFn,
    }),
    getOnAllPluginsLoadedCallback: () => onAllPluginsLoadedCallback,
    mockGoogleApis,
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
      offer: vi.fn(),
      addToolToConversationType: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      config: vi.fn().mockResolvedValue({
        getPluginConfig: () => ({
          preferredAccount,
        }),
        getSystemConfig: () => ({ configDirectory: '/mock/config' }),
      }),
      hooks: {
        onAllPluginsLoaded: (cb: () => Promise<void>) => {
          onAllPluginsLoadedCallback = cb;
        },
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
      request: (pluginId: string) => {
        if (pluginId === 'google-apis') {
          return mockGoogleApis;
        }
        if (pluginId === 'location-broker') {
          return mockLocationBroker;
        }
        return undefined;
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('googleLocationPlugin', () => {
  // We need dynamic import to avoid circular dep issues with module-level vi.mock
  let googleLocationModule: typeof import('./google-location.js');

  beforeEach(async () => {
    vi.resetModules();
    googleLocationModule = await import('./google-location.js');
  });

  it('has correct plugin metadata', () => {
    expect(googleLocationModule.default.pluginMetadata).toMatchObject({
      id: 'google-location',
      name: 'Google Location Plugin',
      brandColor: '#34a853',
      version: 'LATEST',
      required: false,
    });
  });

  it('declares dependencies on google-apis and location-broker', () => {
    const depIds =
      googleLocationModule.default.pluginMetadata.dependencies!.map(d => d.id);
    expect(depIds).toContain('google-apis');
    expect(depIds).toContain('location-broker');
  });

  it('registers as a location provider with id google-location', async () => {
    const mockInterface = createMockPluginInterface(['personal'], {
      personal: { accountId: 'personal', isAuthenticated: true },
    });

    await googleLocationModule.default.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    // Trigger the onAllPluginsLoaded hook
    const callback = mockInterface.getOnAllPluginsLoadedCallback();
    if (callback) {
      await callback();
    }

    expect(mockInterface.getRegisteredProvider().id).toBe('google-location');
    expect(mockInterface.getRegisteredProvider().fn).toBeDefined();
  });

  it('returns empty location data when no accounts are connected', async () => {
    const mockInterface = createMockPluginInterface([]); // No accounts

    await googleLocationModule.default.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    // Trigger the onAllPluginsLoaded hook to register the provider
    const callback = mockInterface.getOnAllPluginsLoadedCallback();
    if (callback) {
      await callback();
    }

    const providerFn = mockInterface.getRegisteredProvider().fn;
    const result = await providerFn!();
    expect(result).toEqual({});
  });

  it('returns empty location data when account is not authenticated', async () => {
    const mockInterface = createMockPluginInterface(['personal'], {
      personal: { accountId: 'personal', isAuthenticated: false },
    });

    await googleLocationModule.default.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    // Trigger the onAllPluginsLoaded hook to register the provider
    const callback = mockInterface.getOnAllPluginsLoadedCallback();
    if (callback) {
      await callback();
    }

    const providerFn = mockInterface.getRegisteredProvider().fn;
    const result = await providerFn!();
    expect(result).toEqual({});
  });

  it('returns empty location data when People client returns null', async () => {
    const mockInterface = createMockPluginInterface(['personal'], {
      personal: { accountId: 'personal', isAuthenticated: true },
    });
    // getPeopleClient already returns null by default

    await googleLocationModule.default.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const callback = mockInterface.getOnAllPluginsLoadedCallback();
    if (callback) {
      await callback();
    }

    const providerFn = mockInterface.getRegisteredProvider().fn;
    const result = await providerFn!();
    expect(result).toEqual({});
  });
});
