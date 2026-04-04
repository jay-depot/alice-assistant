import Type from 'typebox';
import type { Tool } from '../../../lib/tool-system.js';
import type { MoltbookClient } from '../moltbook-client.js';

const sortEnum = Type.Union([
  Type.Literal('hot'),
  Type.Literal('new'),
  Type.Literal('top'),
  Type.Literal('rising'),
]);

const homeParameters = Type.Object({});

const feedParameters = Type.Object({
  source: Type.Optional(Type.Union([Type.Literal('personalized'), Type.Literal('following'), Type.Literal('submolt')], { default: 'personalized' })),
  submolt: Type.Optional(Type.String({ description: 'Required when source is submolt.' })),
  sort: Type.Optional(sortEnum),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 25 })),
  cursor: Type.Optional(Type.String()),
});

type FeedParameters = Type.Static<typeof feedParameters>;

const postParameters = Type.Object({
  postId: Type.String({ description: 'The Moltbook post ID.' }),
});

type PostParameters = Type.Static<typeof postParameters>;

const commentsParameters = Type.Object({
  postId: Type.String({ description: 'The Moltbook post ID whose comments should be retrieved.' }),
  sort: Type.Optional(Type.Union([Type.Literal('best'), Type.Literal('new'), Type.Literal('old')])),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(Type.String()),
  requesterId: Type.Optional(Type.String({ description: 'Optional requester ID to include vote state.' })),
});

type CommentsParameters = Type.Static<typeof commentsParameters>;

const listSubmoltsParameters = Type.Object({});

const getSubmoltParameters = Type.Object({
  name: Type.String({ description: 'The submolt name, without the m/ prefix.' }),
});

type GetSubmoltParameters = Type.Static<typeof getSubmoltParameters>;

const searchParameters = Type.Object({
  query: Type.String({ description: 'Natural-language Moltbook search query.' }),
  type: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('posts'), Type.Literal('comments')])),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
  cursor: Type.Optional(Type.String()),
});

type SearchParameters = Type.Static<typeof searchParameters>;

export const getMoltbookHomeTool = (client: MoltbookClient): Tool => ({
  name: 'getMoltbookHome',
  availableFor: ['chat', 'voice'],
  description: 'Fetches the Moltbook dashboard with account summary, notifications, and suggested next actions.',
  systemPromptFragment: 'Use getMoltbookHome when the user asks what is happening on Moltbook, wants a status overview, or wants to know what needs attention first.',
  parameters: homeParameters,
  toolResultPromptIntro: 'Here is the current Moltbook dashboard.',
  toolResultPromptOutro: '',
  execute: async () => {
    const home = await client.getHome();
    return client.formatHome(home);
  },
});

export const getMoltbookFeedTool = (client: MoltbookClient): Tool => ({
  name: 'getMoltbookFeed',
  availableFor: ['chat', 'voice'],
  description: 'Reads the personalized Moltbook feed, following-only feed, or a specific submolt feed.',
  systemPromptFragment: 'Use getMoltbookFeed when the user wants to browse Moltbook posts. Prefer small limits unless the user asks for a larger slice.',
  parameters: feedParameters,
  toolResultPromptIntro: 'Here are the requested Moltbook feed results.',
  toolResultPromptOutro: '',
  execute: async (args: FeedParameters) => {
    const limit = args.limit ?? client.getDefaultFeedLimit();
    if (args.source === 'submolt') {
      if (!args.submolt) {
        return 'A submolt name is required when source is set to submolt.';
      }

      const feed = await client.getSubmoltFeed({
        submolt: args.submolt,
        sort: args.sort,
        limit,
        cursor: args.cursor,
      });
      return client.formatFeedItems(feed);
    }

    const feed = await client.getFeed({
      sort: args.sort,
      limit,
      cursor: args.cursor,
      filter: args.source === 'following' ? 'following' : 'all',
    });
    return client.formatFeedItems(feed);
  },
});

export const getMoltbookPostTool = (client: MoltbookClient): Tool => ({
  name: 'getMoltbookPost',
  availableFor: ['chat', 'voice'],
  description: 'Retrieves a single Moltbook post by ID.',
  systemPromptFragment: 'Use getMoltbookPost when the user references a specific Moltbook post ID or when a previous tool returned a post ID that needs to be opened.',
  parameters: postParameters,
  toolResultPromptIntro: 'Here is the requested Moltbook post.',
  toolResultPromptOutro: '',
  execute: async (args: PostParameters) => {
    const post = await client.getPost(args.postId);
    return client.formatPost(post);
  },
});

export const getMoltbookCommentsTool = (client: MoltbookClient): Tool => ({
  name: 'getMoltbookComments',
  availableFor: ['chat', 'voice'],
  description: 'Retrieves the comment tree for a Moltbook post.',
  systemPromptFragment: 'Use getMoltbookComments when the user wants to inspect or summarize the conversation underneath a Moltbook post.',
  parameters: commentsParameters,
  toolResultPromptIntro: 'Here is the Moltbook comment thread.',
  toolResultPromptOutro: '',
  execute: async (args: CommentsParameters) => {
    const comments = await client.getComments({
      postId: args.postId,
      sort: args.sort,
      limit: args.limit ?? client.getDefaultCommentLimit(),
      cursor: args.cursor,
      requesterId: args.requesterId,
    });
    return client.formatComments(comments);
  },
});

export const listMoltbookSubmoltsTool = (client: MoltbookClient): Tool => ({
  name: 'listMoltbookSubmolts',
  availableFor: ['chat', 'voice'],
  description: 'Lists Moltbook submolts and their high-level metadata.',
  systemPromptFragment: 'Use listMoltbookSubmolts when the user wants to discover Moltbook communities or needs candidate submolts to browse or subscribe to.',
  parameters: listSubmoltsParameters,
  toolResultPromptIntro: 'Here are the Moltbook submolts that were returned.',
  toolResultPromptOutro: '',
  execute: async () => {
    const submolts = await client.listSubmolts();
    return client.formatSubmoltList(submolts);
  },
});

export const getMoltbookSubmoltTool = (client: MoltbookClient): Tool => ({
  name: 'getMoltbookSubmolt',
  availableFor: ['chat', 'voice'],
  description: 'Retrieves one Moltbook submolt and its metadata.',
  systemPromptFragment: 'Use getMoltbookSubmolt when the user asks about a specific Moltbook community or before subscribing to it.',
  parameters: getSubmoltParameters,
  toolResultPromptIntro: 'Here is the requested Moltbook submolt.',
  toolResultPromptOutro: '',
  execute: async (args: GetSubmoltParameters) => {
    const submolt = await client.getSubmolt(args.name);
    return client.formatSubmolt(submolt);
  },
});

export const searchMoltbookTool = (client: MoltbookClient): Tool => ({
  name: 'searchMoltbook',
  availableFor: ['chat', 'voice'],
  description: 'Runs Moltbook semantic search across posts and comments.',
  systemPromptFragment: 'Use searchMoltbook when the user wants concept-based discovery on Moltbook or when you need to research whether a topic is already being discussed there.',
  parameters: searchParameters,
  toolResultPromptIntro: 'Here are the Moltbook search results.',
  toolResultPromptOutro: '',
  execute: async (args: SearchParameters) => {
    const results = await client.search({
      query: args.query,
      type: args.type,
      limit: args.limit,
      cursor: args.cursor,
    });
    return client.formatSearchResults(results);
  },
});