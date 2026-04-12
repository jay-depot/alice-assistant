import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AlicePluginInterface } from '../../../lib.js';
import type { Tool } from '../../../lib/tool-system.js';
import newsBrokerPlugin from './news-broker.js';

/**
 * Mock plugin interface for testing plugin registration.
 */
function createMockPluginInterface() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const offeredCapabilities: Record<string, any> = {};
  const registeredTools: Tool[] = [];

  return {
    offeredCapabilities,
    registeredTools,
    registerPlugin: async () => {
      return {
        registerTool: (tool: Tool) => {
          registeredTools.push(tool);
        },
        registerHeaderSystemPrompt: vi.fn(),
        registerFooterSystemPrompt: vi.fn(),
        registerConversationType: vi.fn(),
        registerTaskAssistant: vi.fn(),
        addToolToConversationType: vi.fn(),
        config: vi.fn(),
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        offer: (capabilities: any) => {
          offeredCapabilities['news-broker'] = capabilities;
        },
        request: vi.fn(),
      };
    },
  };
}

describe('newsBrokerPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;

  beforeEach(() => {
    mockInterface = createMockPluginInterface();
  });

  it('has correct plugin metadata', () => {
    expect(newsBrokerPlugin.pluginMetadata).toEqual({
      id: 'news-broker',
      name: 'News Broker Plugin',
      description:
        'Provides an API for other plugins to offer news data to the assistant, ' +
        'and for other plugins to request news data from any plugin that offers it.',
      version: 'LATEST',
      dependencies: [
        { id: 'location-broker', version: 'LATEST' },
        { id: 'datetime', version: 'LATEST' },
      ],
      required: false,
    });
  });

  it('registers the getNews tool', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    expect(mockInterface.registeredTools).toHaveLength(1);
    expect(mockInterface.registeredTools[0].name).toBe('getNews');
  });

  it('getNews tool has correct parameters schema', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    // @ts-expect-error -- Test affordance
    expect(tool.parameters.type).toBe('object');
    // @ts-expect-error -- Test affordance
    expect(tool.parameters.properties).toHaveProperty('query');
    // @ts-expect-error -- Test affordance
    expect(tool.parameters.properties.query.description).toContain(
      'news topic'
    );
  });

  it('getNews tool is available for chat, voice, and autonomy', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    expect(tool.availableFor).toEqual(['chat', 'voice', 'autonomy']);
  });

  it('offers news-broker capabilities', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    expect(mockInterface.offeredCapabilities['news-broker']).toBeDefined();
    expect(mockInterface.offeredCapabilities['news-broker']).toHaveProperty(
      'registerNewsProvider'
    );
    expect(mockInterface.offeredCapabilities['news-broker']).toHaveProperty(
      'requestNewsData'
    );
  });

  it('registers news providers correctly', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const brokerApi = mockInterface.offeredCapabilities['news-broker'];
    const mockCallback = vi.fn(async () => []);

    brokerApi.registerNewsProvider('test-provider', mockCallback);
    brokerApi.registerNewsProvider(
      'another-provider',
      vi.fn(async () => [])
    );

    // Request news to verify providers are stored
    const result = await brokerApi.requestNewsData('test query');
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['test-provider']).toBeDefined();
    expect(result['another-provider']).toBeDefined();
  });

  it('returns empty object when no providers are registered', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const brokerApi = mockInterface.offeredCapabilities['news-broker'];
    const result = await brokerApi.requestNewsData('any query');

    expect(result).toEqual({});
  });

  it('calls all registered providers with the query', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const brokerApi = mockInterface.offeredCapabilities['news-broker'];
    const provider1Callback = vi.fn(async () => []);
    const provider2Callback = vi.fn(async () => []);

    brokerApi.registerNewsProvider('provider1', provider1Callback);
    brokerApi.registerNewsProvider('provider2', provider2Callback);

    await brokerApi.requestNewsData('artificial intelligence updates');

    // 'updates' is not a filler word, so it should be preserved
    expect(provider1Callback).toHaveBeenCalledWith(
      'artificial intelligence updates'
    );
    expect(provider2Callback).toHaveBeenCalledWith(
      'artificial intelligence updates'
    );
  });

  it('cleans query by removing common filler words', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const brokerApi = mockInterface.offeredCapabilities['news-broker'];
    const providerCallback = vi.fn(async () => []);

    brokerApi.registerNewsProvider('provider', providerCallback);

    await brokerApi.requestNewsData('news about technology today');

    // Should remove 'news', 'about', and 'today'
    expect(providerCallback).toHaveBeenCalledWith('technology');
  });

  it('aggregates results from multiple providers', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const brokerApi = mockInterface.offeredCapabilities['news-broker'];

    const newsFromProvider1 = [
      {
        headline: 'Tech Story 1',
        url: 'http://example.com/1',
        source: 'TechNews',
        age: '2 hours',
      },
    ];

    const newsFromProvider2 = [
      {
        headline: 'Tech Story 2',
        url: 'http://example.com/2',
        source: 'TechToday',
        age: '1 hour',
      },
    ];

    brokerApi.registerNewsProvider('provider1', async () => newsFromProvider1);
    brokerApi.registerNewsProvider('provider2', async () => newsFromProvider2);

    const result = await brokerApi.requestNewsData('technology');

    expect(result.provider1).toEqual(newsFromProvider1);
    expect(result.provider2).toEqual(newsFromProvider2);
  });

  it('handles provider that returns empty array', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const brokerApi = mockInterface.offeredCapabilities['news-broker'];

    brokerApi.registerNewsProvider('empty-provider', async () => []);
    brokerApi.registerNewsProvider('provider-with-news', async () => [
      {
        headline: 'News Item',
        url: 'http://example.com',
        source: 'Source',
        age: '1 hour',
      },
    ]);

    const result = await brokerApi.requestNewsData('query');

    expect(result['empty-provider']).toEqual([]);
    expect(result['provider-with-news']).toHaveLength(1);
  });

  it('getNews tool returns "No news data available" when no data', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    // @ts-expect-error -- Test affordance
    const result = await tool.execute({ query: 'anything' });

    expect(result).toBe('No news data available for this query.');
  });

  it('getNews tool formats news items correctly', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const brokerApi = mockInterface.offeredCapabilities['news-broker'];
    const tool = mockInterface.registeredTools[0];

    brokerApi.registerNewsProvider('TestProvider', async () => [
      {
        headline: 'Breaking: Technology Update',
        preview: 'A significant update in the tech industry',
        url: 'https://example.com/article',
        source: 'TechNews',
        age: '2 hours',
      },
    ]);
    // @ts-expect-error -- Test affordance
    const result = await tool.execute({ query: 'technology' });

    expect(result).toContain('News from TestProvider:');
    expect(result).toContain('Breaking: Technology Update');
    expect(result).toContain('TechNews');
    expect(result).toContain('2 hours ago');
    expect(result).toContain('https://example.com/article');
    expect(result).toContain('A significant update in the tech industry');
  });

  it('getNews tool formats multiple providers', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const brokerApi = mockInterface.offeredCapabilities['news-broker'];
    const tool = mockInterface.registeredTools[0];

    brokerApi.registerNewsProvider('Provider1', async () => [
      {
        headline: 'Story 1',
        url: 'http://example.com/1',
        source: 'Source1',
        age: '1 hour',
      },
    ]);

    brokerApi.registerNewsProvider('Provider2', async () => [
      {
        headline: 'Story 2',
        url: 'http://example.com/2',
        source: 'Source2',
        age: '2 hours',
      },
    ]);

    // @ts-expect-error -- Test affordance
    const result = await tool.execute({ query: 'news' });

    expect(result).toContain('News from Provider1:');
    expect(result).toContain('News from Provider2:');
    expect(result).toContain('Story 1');
    expect(result).toContain('Story 2');
  });

  it('toolResultPromptOutro includes link reminder for chat', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    // @ts-expect-error -- Test affordance
    const chatOutro = tool.toolResultPromptOutro('chat');

    expect(chatOutro).toContain('ALWAYS INCLUDE LINKS');
  });

  it('toolResultPromptOutro is empty for non-chat types', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const tool = mockInterface.registeredTools[0];
    // @ts-expect-error -- Test affordance
    const voiceOutro = tool.toolResultPromptOutro('voice');

    expect(voiceOutro).toBe('');
  });

  it('plugin is not required', () => {
    expect(newsBrokerPlugin.pluginMetadata.required).toBe(false);
  });

  it('handles news items without preview field', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const brokerApi = mockInterface.offeredCapabilities['news-broker'];
    const tool = mockInterface.registeredTools[0];

    brokerApi.registerNewsProvider('Provider', async () => [
      {
        headline: 'News Without Preview',
        url: 'http://example.com',
        source: 'Source',
        age: '1 hour',
      },
    ]);

    // @ts-expect-error -- Test affordance
    const result = await tool.execute({ query: 'query' });

    expect(result).toContain('News Without Preview');
    expect(result).toContain('http://example.com');
    // Should not error and should handle missing preview gracefully
  });

  it('cleans query with various filler words and date terms', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const brokerApi = mockInterface.offeredCapabilities['news-broker'];
    const providerCallback = vi.fn(async () => []);

    brokerApi.registerNewsProvider('provider', providerCallback);

    // Query with multiple filler words
    await brokerApi.requestNewsData(
      'news regarding latest headlines on technology yesterday'
    );

    // Should be cleaned to just 'technology'
    expect(providerCallback).toHaveBeenCalledWith('technology');
  });

  it('preserves important keywords during query cleaning', async () => {
    await newsBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const brokerApi = mockInterface.offeredCapabilities['news-broker'];
    const providerCallback = vi.fn(async () => []);

    brokerApi.registerNewsProvider('provider', providerCallback);

    await brokerApi.requestNewsData('news about artificial intelligence');

    // Should remove 'news' and 'about' but keep 'artificial' and 'intelligence'
    expect(providerCallback).toHaveBeenCalledWith('artificial intelligence');
  });
});
