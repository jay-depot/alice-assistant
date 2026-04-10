import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import { cookieJar } from './cookie-jar.js';

const MINUTES = 60 * 1000;
const MAX_CHUNK_SIZE = 160000;

const SimpleFetchToolParametersSchema = Type.Object({
  url: Type.String({ description: 'The URL to fetch data from.' }),
  headers: Type.Optional(Type.Record(Type.String(), Type.String(), { description: 'Additional headers to include in the POST request.' })),
  startReadingFrom: Type.Optional(Type.Number({ minimum: 0,description: 'The character index to start reading from for the fetched content. This is useful for fetching large web pages in chunks to avoid overflowing the context window. Set this parameter OR startReadingFromKeyword, but not both.' })),
  startReadingFromKeyword: Type.Optional(Type.Object({
    keyword: Type.String({ description: 'A unique keyword to search for in the fetched content to determine the character index to start reading from. This is useful for fetching large web pages in chunks when you cannot determine the appropriate startReadingFrom index ahead of time but can identify a keyword in the content to start from.' }),
    occurrence: Type.Optional(Type.Number({ minimum: 1, description: 'If the startReadingFromKeyword appears multiple times in the content, this specifies which occurrence of the keyword to use as the starting point. For example, if keyword is "Alice" and occurrence is 2, then the starting index will be the index of the second occurrence of "Alice" in the content. If not specified, it defaults to 1 (the first occurrence).' })),
  })),
  limit: Type.Optional(Type.Number({ minimum: 0, maximum: MAX_CHUNK_SIZE, description: 'The maximum number of characters to return from the fetched content starting from the startReadingFrom index. This is useful for fetching large web pages in chunks to avoid overflowing the context window.' })),
});

type SimpleFetchToolParameters = Type.Static<typeof SimpleFetchToolParametersSchema>;

const SimplePostToolParametersSchema = Type.Object({
  url: Type.String({ description: 'The URL to send the POST request to.' }),
  body: Type.String({ description: 'The body of the POST request.' }),
  contentType: Type.Optional(Type.String({ description: 'The content type of the POST request body. This defaults to application/json if not specified.' })),
  headers: Type.Optional(Type.Record(Type.String(), Type.String(), { description: 'Additional headers to include in the POST request beyond Content-Type.' })),
  paginationKey: Type.Optional(Type.String({ description: 'A unique key to identify this POST request for pagination purposes. This is used in conjunction with the startReadingFrom and limit parameters to page through large responses without sending the same POST request multiple times.' })),
  startReadingFrom: Type.Optional(Type.Number({ minimum: 0,description: 'The character index to start reading from for the fetched content. This is useful for fetching large responses in chunks to avoid overflowing the context window. Set this parameter OR startReadingFromKeyword, but not both.' })),
  startReadingFromKeyword: Type.Optional(Type.Object({
    keyword: Type.String({ description: 'A unique keyword to search for in the fetched content to determine the character index to start reading from. This is useful for fetching large responses in chunks when you cannot determine the appropriate startReadingFrom index ahead of time but can identify a keyword in the content to start from.' }),
    occurrence: Type.Optional(Type.Number({ minimum: 1, description: 'If the startReadingFromKeyword appears multiple times in the content, this specifies which occurrence of the keyword to use as the starting point. For example, if keyword is "Alice" and occurrence is 2, then the starting index will be the index of the second occurrence of "Alice" in the content. If not specified, it defaults to 1 (the first occurrence).' })),
  })),
  limit: Type.Optional(Type.Number({ minimum: 0, maximum: MAX_CHUNK_SIZE, description: 'The maximum number of characters to return from the fetched content starting from the startReadingFrom index. This is useful for fetching large responses in chunks to avoid overflowing the context window.' })),
});

type SimplePostToolParameters = Type.Static<typeof SimplePostToolParametersSchema>;

const fetchCache = new Map<string, { url: string; data: string, headers?: Record<string, string>, timestamp: Date }>();
const postResponseCache = new Map<string, { url: string; body: string; data: string, headers?: Record<string, string>, contentType: string, timestamp: Date }>();

function getIndex(args: { startReadingFrom?: number; startReadingFromKeyword?: { keyword: string; occurrence?: number } }, data: string): number {
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

const MAX_REDIRECTS = 100;

async function recursiveFetchWithAllCookiesCaptured(url: string, options: RequestInit, redirectCount = 0): Promise<Response> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (exceeded limit of ${MAX_REDIRECTS})`);
  }

  const response = await fetch(url, {
    ...options,
    redirect: 'manual',
  });

  const cookies = response.headers.getSetCookie();
  console.log({ cookies });

  if (cookies && cookies.length > 0) {
    cookieJar.setCookies(new URL(url).hostname, cookies);
  }

  if (response.status >= 301 && response.status <= 308) {
    const location = response.headers.get('Location');
    if (location) {
      const redirectUrl = new URL(location, url).href;
      return recursiveFetchWithAllCookiesCaptured(redirectUrl, options, redirectCount + 1);
    }
  }

  return response;
}

const webSimpleFetchPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'web-simple-fetch',
    name: 'Web Simple Fetch Plugin',
    description: 'Provides the assistant a tool for making HTTP requests to fetch ' +
      'data from the web for use when fetching anything other than HTML.',
    version: 'LATEST',
    dependencies: [],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.registerTool({
      name: 'simpleFetch',
      description: 'Call simpleFetch when you need to fetch data from the web that ' +
        'is not HTML, or you need to see the "raw html" of a web page. This tool is ' +
        'intended for fetching data from the web that is not HTML, such as APIs that ' +
        'return JSON, XML, or even plain text and markdown. Only call simpleFetch when ' +
        'you need data from a server on the internet and no other available tool that ' +
        'specifically handles it. DO NOT USE simpleFetch TO WORK AROUND ERRORS IN YOUR ' +
        'OTHER TOOLS UNLESS THE USER SPECIFICALLY GIVES YOU PERMISSION. YOU MAY ASK FOR ' +
        'PERMISSION TO DO THIS. simpleFetch will ret',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: SimpleFetchToolParametersSchema,
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async function (args: SimpleFetchToolParameters): Promise<string> {
        const { url, headers } = args as SimpleFetchToolParameters;
        const cacheKey = `${url}::${headers?.['Accept'] ?? '*/*'}`;

        const data = await (async () => {
          const cached = fetchCache.get(cacheKey);
          if (cached && (new Date().getTime() - cached.timestamp.getTime()) < 5 * MINUTES) {
            return cached.data;
          }
          
          const response = await recursiveFetchWithAllCookiesCaptured(url, {
            headers: {
              'Cookie': cookieJar.getCookieHeaderForSite(url),
              'Accept': headers?.['Accept'] ?? '*/*',
              ...headers,
            }
          });


          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          const data = await response.text();
          fetchCache.set(cacheKey, { url, data, headers, timestamp: new Date() });
          return data;
        })();
        
        const limit = args.limit ?? MAX_CHUNK_SIZE;

        if (limit > MAX_CHUNK_SIZE) {
          return `Sorry, for your own safety, I cannot return more than ${MAX_CHUNK_SIZE} characters ` +
            'of data at a time. Please specify a smaller limit.';
        }
        
        const start = getIndex(args, data);
        const end = start + limit;
        return data.slice(start, end);
      }
    });

    plugin.registerTool({
      name: 'simplePost',
      description: 'Call simplePost when you need to send a POST request to the web. This is ' +
        'intended for sending data to web APIs. Only call simplePost when you need to send data ' +
        'to a server on the internet and no other available tool that specifically handles it. ' +
        'DO NOT USE simplePost TO WORK AROUND ERRORS IN YOUR OTHER TOOLS UNLESS THE USER SPECIFICALLY ' +
        'GIVES YOU PERMISSION. YOU MAY ASK FOR PERMISSION TO DO THIS. If you provide a paginationKey, ' +
        'then results from simplePost will be cached for 5 minutes based on that paginationKey alone, ' +
        'so you can page through a large response without sending the same POST request multiple times.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: SimplePostToolParametersSchema,
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async function (args: SimplePostToolParameters): Promise<string> {
        const { url, body, paginationKey, contentType, headers } = args as SimplePostToolParameters;

        const data = await (async () => {
          const cached = paginationKey ? postResponseCache.get(paginationKey) : undefined;
          if (cached && (new Date().getTime() - cached.timestamp.getTime()) < 5 * MINUTES) {
            return cached.data;
          }
          
          const response = await recursiveFetchWithAllCookiesCaptured(url, {
            method: 'POST',
            headers: { 
              'Cookie': cookieJar.getCookieHeaderForSite(url),
              'Content-Type': contentType ?? 'application/json',
              'Accept': headers?.['Accept'] ?? '*/*',
              ...headers 
            },
            body: body,
          });
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          const data = await response.text();

          if (paginationKey) {
            postResponseCache.set(paginationKey, { url, body, data, timestamp: new Date(), headers, contentType });
          }

          return data;
        })();
        
        const limit = args.limit ?? MAX_CHUNK_SIZE;

        if (limit > MAX_CHUNK_SIZE) {
          return `Sorry, for your own safety, I cannot return more than ${MAX_CHUNK_SIZE} characters ` +
            'of data at a time. Please specify a smaller limit.';
        }

        const start = getIndex(args, data);

        if (start === -1) {
          return `Sorry, I could not find the of the keyword "${args.startReadingFromKeyword?.keyword}" in the response data, or it occurs fewer than ${args.startReadingFromKeyword?.occurrence} time(s). Please check the keyword and try again.`;
        }

        const end = start + limit;
        return data.slice(start, end);
      }
    });

    plugin.registerTool({
      name: 'getCachedPosts',
      description: 'Call getCachedPosts to retrieve a list of currently cached POST request ' +
        '`paginationKey`s, their URLs, and their timestamps. Use this if you need to find ' +
        'the cache key for a POST request you made with simplePost that you want to page through ' +
        'using the pagination functionality.',
      availableFor: ['chat', 'voice', 'autonomy'],
      systemPromptFragment: '',
      parameters: Type.Object({}),
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async function (): Promise<string> {
        const cachedPosts = Array.from(postResponseCache.values())
          .filter(entry => (new Date().getTime() - entry.timestamp.getTime()) < 5 * MINUTES)
          .map(entry => ({
          paginationKey: entry.url, // This is not ideal but it works for now since the URL is also part of the cache key. We can add a separate paginationKey to the cache in the future if needed.
          url: entry.url,
          timestamp: entry.timestamp,
        }));
        return JSON.stringify(cachedPosts, null, 2);
      }
    });
  }
};

export default webSimpleFetchPlugin;
