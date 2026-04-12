import { describe, it, expect, vi } from 'vitest';

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
import StaticLocationPlugin from './static-location.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LocationConfig = {
  localityName?: string;
  regionName?: string;
  countryName?: string;
  coordinates: { latitude: number; longitude: number };
};

function createMockPluginInterface(locationConfig: LocationConfig) {
  let registeredProviderId: string | null = null;
  let registeredProviderFn: (() => Promise<LocationConfig>) | null = null;

  return {
    getRegisteredProvider: () => ({
      id: registeredProviderId,
      fn: registeredProviderFn,
    }),
    registerPlugin: async () => ({
      registerTool: vi.fn(),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      offer: vi.fn(),
      addToolToConversationType: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      config: vi.fn().mockResolvedValue({
        getPluginConfig: () => locationConfig,
        getSystemConfig: () => ({ configDirectory: '/mock/config' }),
      }),
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
      request: (pluginId: string) => {
        if (pluginId === 'location-broker') {
          return {
            registerLocationProvider: (
              id: string,
              fn: () => Promise<LocationConfig>
            ) => {
              registeredProviderId = id;
              registeredProviderFn = fn;
            },
            requestLocationData: vi.fn(),
          };
        }
        return undefined;
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StaticLocationPlugin', () => {
  it('has correct plugin metadata', () => {
    expect(StaticLocationPlugin.pluginMetadata).toMatchObject({
      id: 'static-location',
      name: 'Static Location Plugin',
      version: 'LATEST',
      required: false,
    });
  });

  it('declares a dependency on location-broker', () => {
    const depIds = StaticLocationPlugin.pluginMetadata.dependencies!.map(
      d => d.id
    );
    expect(depIds).toContain('location-broker');
  });

  it('registers a location provider with id static-location', async () => {
    const mockInterface = createMockPluginInterface({
      coordinates: { latitude: 51.5, longitude: -0.1 },
    });
    await StaticLocationPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockInterface.getRegisteredProvider().id).toBe('static-location');
  });

  it('registered provider returns the full configured location data', async () => {
    const config: LocationConfig = {
      localityName: 'London',
      regionName: 'Greater London',
      countryName: 'United Kingdom',
      coordinates: { latitude: 51.5074, longitude: -0.1278 },
    };
    const mockInterface = createMockPluginInterface(config);
    await StaticLocationPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const { fn } = mockInterface.getRegisteredProvider();
    const result = await fn!();
    expect(result).toEqual(config);
  });

  it('registered provider returns default coordinates when only coordinates are configured', async () => {
    const defaultConfig: LocationConfig = {
      coordinates: { latitude: 0, longitude: 0 },
    };
    const mockInterface = createMockPluginInterface(defaultConfig);
    await StaticLocationPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const { fn } = mockInterface.getRegisteredProvider();
    const result = await fn!();
    expect(result.coordinates).toEqual({ latitude: 0, longitude: 0 });
    expect(result.localityName).toBeUndefined();
    expect(result.regionName).toBeUndefined();
    expect(result.countryName).toBeUndefined();
  });
});
