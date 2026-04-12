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
import webSearchBrokerPlugin from './web-search-broker.js';

type WebSearchResult = {
  title: string;
  snippet: string;
  url: string;
};

function createMockPluginInterface(preferredSearchProvider?: string) {
  const offeredCapabilities: Record<string, any> = {};
  const registeredTools: any[] = [];

  return {
    offeredCapabilities,
    registeredTools,
    registerPlugin: async () => ({
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
        offeredCapabilities['web-search-broker'] = caps;
      },
      config: vi.fn().mockResolvedValue({
        getPluginConfig: () => ({ preferredSearchProvider }),
      }),
    }),
  };
}

describe('webSearchBrokerPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;
  let api: {
    registerWebSearchProvider: (
      name: string,
      callback: (query: string) => Promise<WebSearchResult[]>
    ) => void;
    requestWebSearchData: (
      query: string
    ) => Promise<Record<string, WebSearchResult[]>>;
    getPreferredProviderId: () => Promise<string>;
  };

  beforeEach(async () => {
    mockInterface = createMockPluginInterface();
    await webSearchBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    api = mockInterface.offeredCapabilities['web-search-broker'];
  });

  it('has correct plugin metadata', () => {
    expect(webSearchBrokerPlugin.pluginMetadata).toMatchObject({
      id: 'web-search-broker',
      name: 'Web Search Broker Plugin',
      version: 'LATEST',
      required: false,
    });
  });

  it('has no plugin dependencies', () => {
    expect(webSearchBrokerPlugin.pluginMetadata.dependencies).toEqual([]);
  });

  it('offers registerWebSearchProvider, requestWebSearchData, and getPreferredProviderId', () => {
    expect(typeof api.registerWebSearchProvider).toBe('function');
    expect(typeof api.requestWebSearchData).toBe('function');
    expect(typeof api.getPreferredProviderId).toBe('function');
  });

  it('registers the webSearch tool', () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'webSearch'
    );
    expect(tool).toBeDefined();
  });

  it('webSearch tool is available for chat, voice, and autonomy', () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'webSearch'
    );
    expect(tool.availableFor).toContain('chat');
    expect(tool.availableFor).toContain('voice');
    expect(tool.availableFor).toContain('autonomy');
  });

  it('requestWebSearchData returns an empty object when no providers are registered', async () => {
    const result = await api.requestWebSearchData('test query');
    expect(result).toEqual({});
  });

  it('requestWebSearchData calls provider callback with query and returns keyed results', async () => {
    const provider = vi.fn(async (query: string) => [
      {
        title: `Result for ${query}`,
        snippet: 'Snippet text',
        url: 'https://example.com',
      },
    ]);

    api.registerWebSearchProvider('example-provider', provider);

    const result = await api.requestWebSearchData('alice');
    expect(provider).toHaveBeenCalledWith('alice');
    expect(result).toHaveProperty('example-provider');
    expect(result['example-provider']).toHaveLength(1);
  });

  it('requestWebSearchData aggregates results from multiple providers', async () => {
    api.registerWebSearchProvider('provider-a', async () => [
      { title: 'A1', snippet: 'A snippet', url: 'https://a.example' },
    ]);
    api.registerWebSearchProvider('provider-b', async () => [
      { title: 'B1', snippet: 'B snippet', url: 'https://b.example' },
      { title: 'B2', snippet: 'B2 snippet', url: 'https://b2.example' },
    ]);

    const result = await api.requestWebSearchData('hello');
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['provider-a']).toHaveLength(1);
    expect(result['provider-b']).toHaveLength(2);
  });

  it('registerWebSearchProvider with same name overrides the previous callback', async () => {
    const first = vi.fn(async () => [
      { title: 'Old', snippet: 'Old', url: 'https://old.example' },
    ]);
    const second = vi.fn(async () => [
      { title: 'New', snippet: 'New', url: 'https://new.example' },
    ]);

    api.registerWebSearchProvider('same', first);
    api.registerWebSearchProvider('same', second);

    const result = await api.requestWebSearchData('q');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(result['same'][0].title).toBe('New');
  });

  it('getPreferredProviderId returns configured preferredSearchProvider', async () => {
    const configuredInterface = createMockPluginInterface('brave-search');
    await webSearchBrokerPlugin.registerPlugin(
      configuredInterface as unknown as AlicePluginInterface
    );
    const configuredApi =
      configuredInterface.offeredCapabilities['web-search-broker'];

    await expect(configuredApi.getPreferredProviderId()).resolves.toBe(
      'brave-search'
    );
  });

  it('getPreferredProviderId returns empty string when not configured', async () => {
    await expect(api.getPreferredProviderId()).resolves.toBe('');
  });

  it('webSearch tool formats multi-provider results with sections and numbered results', async () => {
    api.registerWebSearchProvider('provider-a', async () => [
      {
        title: 'First title',
        snippet: 'First snippet',
        url: 'https://first.example',
      },
    ]);
    api.registerWebSearchProvider('provider-b', async () => [
      {
        title: 'Second title',
        snippet: 'Second snippet',
        url: 'https://second.example',
      },
      {
        title: 'Third title',
        snippet: 'Third snippet',
        url: 'https://third.example',
      },
    ]);

    const tool = mockInterface.registeredTools.find(
      t => t.name === 'webSearch'
    );
    const result = await tool.execute({ query: 'best tea kettle' });

    expect(result).toContain('## Results from provider-a');
    expect(result).toContain('## Results from provider-b');
    expect(result).toContain('Result 1:');
    expect(result).toContain('Result 2:');
    expect(result).toContain('Title: First title');
    expect(result).toContain('Snippet: Third snippet');
    expect(result).toContain('URL: https://second.example');
  });

  it('webSearch tool returns empty string when no providers are available', async () => {
    const tool = mockInterface.registeredTools.find(
      t => t.name === 'webSearch'
    );
    const result = await tool.execute({ query: 'anything' });
    expect(result).toBe('');
  });
});
