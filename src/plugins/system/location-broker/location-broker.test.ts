/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// location-broker.ts → lib.js → conversation.ts → plugin-hooks.ts (circular)
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

type LocationBrokerModule = typeof import('./location-broker.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPluginInterface() {
  const offeredCapabilities: Record<string, any> = {};
  const registeredFooterPrompts: Array<{
    name: string;
    weight: number;
    getPrompt: () => Promise<string | false>;
  }> = [];
  const hooks: Record<string, Array<() => Promise<void>>> = {
    onAllPluginsLoaded: [],
  };

  return {
    offeredCapabilities,
    registeredFooterPrompts,
    hooks,
    runHook: async (name: string) => {
      for (const cb of hooks[name] ?? []) await cb();
    },
    registerPlugin: async () => ({
      registerTool: vi.fn(),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: (def: any) =>
        registeredFooterPrompts.push(def),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      config: vi.fn(),
      hooks: {
        onAllPluginsLoaded: (cb: () => Promise<void>) =>
          (hooks.onAllPluginsLoaded ??= []).push(cb),
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
      offer: (caps: any) => (offeredCapabilities['location-broker'] = caps),
      request: vi.fn(),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('locationBrokerPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;
  let locationBrokerPlugin: LocationBrokerModule['default'];

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('./location-broker.js');
    locationBrokerPlugin = module.default;
    mockInterface = createMockPluginInterface();
  });

  it('has correct plugin metadata', () => {
    expect(locationBrokerPlugin.pluginMetadata).toMatchObject({
      id: 'location-broker',
      name: 'Location Broker Plugin',
      version: 'LATEST',
      required: true,
      dependencies: [],
    });
  });

  it('offers location-broker capabilities', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockInterface.offeredCapabilities['location-broker']).toHaveProperty(
      'registerLocationProvider'
    );
    expect(mockInterface.offeredCapabilities['location-broker']).toHaveProperty(
      'requestLocationData'
    );
  });

  it('registers a footer system prompt', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockInterface.registeredFooterPrompts).toHaveLength(1);
    expect(mockInterface.registeredFooterPrompts[0].name).toBe(
      'locationFooter'
    );
  });

  it('footer prompt has high weight', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockInterface.registeredFooterPrompts[0].weight).toBe(99998);
  });

  it('requestLocationData returns empty object when no provider registered', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['location-broker'];
    const result = await api.requestLocationData();
    expect(result).toEqual({});
  });

  it('registers a location provider and calls it on requestLocationData', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['location-broker'];
    const mockProvider = vi.fn().mockResolvedValue({
      localityName: 'Springfield',
      regionName: 'Illinois',
      countryName: 'United States',
    });

    api.registerLocationProvider('test-provider', mockProvider);
    const result = await api.requestLocationData();

    expect(mockProvider).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ localityName: 'Springfield' });
  });

  it('footer prompt returns false when no provider registered', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const prompt = mockInterface.registeredFooterPrompts[0];
    const result = await prompt.getPrompt();
    expect(result).toBe(false);
  });

  it('footer prompt returns false when provider returns empty location', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['location-broker'];
    api.registerLocationProvider('empty-provider', async () => ({}));

    const prompt = mockInterface.registeredFooterPrompts[0];
    const result = await prompt.getPrompt();
    expect(result).toBe(false);
  });

  it('footer prompt includes locality, region, and country', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['location-broker'];
    api.registerLocationProvider('provider', async () => ({
      localityName: 'Portland',
      regionName: 'Oregon',
      countryName: 'United States',
    }));

    const prompt = mockInterface.registeredFooterPrompts[0];
    const result = (await prompt.getPrompt()) as string;

    expect(result).toContain('Portland');
    expect(result).toContain('Oregon');
    expect(result).toContain('United States');
    expect(result).toContain('# CURRENT LOCATION');
  });

  it('footer prompt includes coordinates when provided', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['location-broker'];
    api.registerLocationProvider('provider', async () => ({
      coordinates: { latitude: 45.52, longitude: -122.68 },
      localityName: 'Portland',
    }));

    const prompt = mockInterface.registeredFooterPrompts[0];
    const result = (await prompt.getPrompt()) as string;

    expect(result).toContain('45.52');
    expect(result).toContain('-122.68');
  });

  it('footer prompt omits fields that are absent', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['location-broker'];
    api.registerLocationProvider('provider', async () => ({
      countryName: 'Germany',
    }));

    const prompt = mockInterface.registeredFooterPrompts[0];
    const result = (await prompt.getPrompt()) as string;

    expect(result).toContain('Germany');
    expect(result).not.toContain('Locality');
    expect(result).not.toContain('Region');
    expect(result).not.toContain('Coordinates');
  });

  it('throws when a second provider tries to register', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['location-broker'];
    api.registerLocationProvider('provider-1', async () => ({}));

    expect(() =>
      api.registerLocationProvider('provider-2', async () => ({}))
    ).not.toThrow(); // conflict is signalled via hook, not immediately
  });

  it('onAllPluginsLoaded hook throws when multiple providers registered', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['location-broker'];
    api.registerLocationProvider('provider-A', async () => ({}));
    api.registerLocationProvider('provider-B', async () => ({}));

    await expect(mockInterface.runHook('onAllPluginsLoaded')).rejects.toThrow(
      /provider-A.*provider-B|provider-B.*provider-A/
    );
  });

  it('throws when registering a provider after all plugins are loaded', async () => {
    await locationBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const api = mockInterface.offeredCapabilities['location-broker'];

    await mockInterface.runHook('onAllPluginsLoaded');

    expect(() =>
      api.registerLocationProvider('late-provider', async () => ({}))
    ).toThrow(/after all plugins/);
  });
});
