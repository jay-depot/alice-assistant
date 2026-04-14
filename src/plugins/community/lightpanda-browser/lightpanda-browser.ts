import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import { type LightpandaFetchOptions, lightpanda } from '@lightpanda/browser';

const MINUTES = 60 * 1000;
const MAX_CHUNK_SIZE = 160000;
const CACHE_TTL = 10 * MINUTES; // Cache lightpanda responses for 10 minutes

const LightpandaFetchToolParameterSchema = Type.Object({
  url: Type.String({ description: 'The URL to fetch' }),
  startReadingFrom: Type.Optional(
    Type.Number({
      minimum: 0,
      description:
        'The character index to start reading from for the fetched content. This is useful for fetching large web pages in chunks to avoid overflowing the context window. Set this parameter OR startReadingFromKeyword, but not both.',
    })
  ),
  startReadingFromKeyword: Type.Optional(
    Type.Object({
      keyword: Type.String({
        description:
          'A unique keyword to search for in the fetched content to determine the character index to start reading from. This is useful for fetching large web pages in chunks when you cannot determine the appropriate startReadingFrom index ahead of time but can identify a keyword in the content to start from.',
      }),
      occurrence: Type.Optional(
        Type.Number({
          minimum: 1,
          description:
            'If the startReadingFromKeyword appears multiple times in the content, this specifies which occurrence of the keyword to use as the starting point. For example, if keyword is "Alice" and occurrence is 2, then the starting index will be the index of the second occurrence of "Alice" in the content. If not specified, it defaults to 1 (the first occurrence).',
        })
      ),
    })
  ),
  limit: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: MAX_CHUNK_SIZE,
      description:
        'The maximum number of characters to return from the fetched content starting from the startReadingFrom index. This is useful for fetching large web pages in chunks to avoid overflowing the context window.',
    })
  ),
  bypassCache: Type.Optional(
    Type.Boolean({
      description:
        'If true, bypasses the cache and fetches a fresh copy of the page. Use this when you need the most current version of a page. Default is false.',
    })
  ),
});

export type LightpandaFetchToolParameters = Type.Static<
  typeof LightpandaFetchToolParameterSchema
>;

// Cache store for lightpanda fetch results: url -> { data, timestamp }
const lightpandaCache = new Map<
  string,
  {
    url: string;
    data: string;
    timestamp: Date;
  }
>();

function getIndex(
  args: {
    startReadingFrom?: number;
    startReadingFromKeyword?: { keyword: string; occurrence?: number };
  },
  data: string
): number {
  if (args.startReadingFrom !== undefined) {
    return args.startReadingFrom;
  }
  if (args.startReadingFromKeyword) {
    const { keyword, occurrence = 1 } = args.startReadingFromKeyword;
    let foundIndex = -1;
    let index = -1;
    let count = 0;
    while (count < occurrence) {
      index = data.indexOf(keyword, index + 1);
      if (index === -1) break;
      foundIndex = index;
      count++;
    }
    return foundIndex;
  }
  return 0;
}

function getCacheKey(url: string): string {
  return url;
}

function isCacheValid(entry: { timestamp: Date }): boolean {
  const age = Date.now() - entry.timestamp.getTime();
  return age < CACHE_TTL;
}

const lightpandaBrowserPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'lightpanda-browser',
    name: 'LightPanda Browser Plugin',
    brandColor: '#3f4884',
    description:
      'Lets your assistant fetch web pages using the lightpanda browser with support for chunked reading and caching',
    version: 'LATEST',
    dependencies: [],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.registerTool({
      name: 'lightpandaFetch',
      description:
        'Call lightpandaFetch when the user asks you to fetch a web page for ' +
        'them, or information from a web page, or information available on a web page, or ' +
        'when you need information that can be found on a web page to complete an assigned ' +
        'task. lightpanda is a *fast* web browser designed for you! It turns web pages into ' +
        'text you can read. For large pages, use startReadingFrom and limit to chunk the response.',
      parameters: LightpandaFetchToolParameterSchema,
      availableFor: ['chat', 'voice'],
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      taintStatus: 'tainted', // Arbitrary web content, literally anything. Always taint.
      execute: async (parameters: LightpandaFetchToolParameters) => {
        const { url, bypassCache = false } = parameters;
        const cacheKey = getCacheKey(url);

        // Check cache first (unless bypassed)
        let cachedEntry = !bypassCache
          ? lightpandaCache.get(cacheKey)
          : undefined;
        if (cachedEntry && isCacheValid(cachedEntry)) {
          // Use cached data
        } else {
          // Fetch fresh data
          const fetchOptions: LightpandaFetchOptions = {
            dump: true,
            dumpOptions: {
              type: 'markdown',
            },
          };
          try {
            const response = await lightpanda.fetch(url, fetchOptions);
            cachedEntry = {
              url,
              data:
                typeof response === 'string' ? response : response.toString(),
              timestamp: new Date(),
            };
            lightpandaCache.set(cacheKey, cachedEntry);
          } catch (error) {
            plugin.logger.error('Error fetching URL with lightpanda:', error);
            return `There was an error while trying to fetch the page at ${url}`;
          }
        }

        // Apply offset/limit chunking
        const startIndex = getIndex(parameters, cachedEntry.data);
        const limit = parameters.limit ?? MAX_CHUNK_SIZE;
        const endIndex = startIndex + limit;
        const chunk = cachedEntry.data.slice(startIndex, endIndex);

        return `CONTENTS OF PAGE AT: ${url}\n=========\n\n${chunk}\n\n[Characters ${startIndex}–${endIndex} of ${cachedEntry.data.length}]`;
      },
    });
  },
};

export default lightpandaBrowserPlugin;
