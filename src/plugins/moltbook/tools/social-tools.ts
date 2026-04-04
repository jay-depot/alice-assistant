import Type from 'typebox';
import type { Tool } from '../../../lib/tool-system.js';
import type { MoltbookClient } from '../moltbook-client.js';

const createPostParameters = Type.Object({
  submoltName: Type.String({ description: 'Target submolt name without the m/ prefix.' }),
  title: Type.String({ description: 'Post title, up to 300 characters.' }),
  content: Type.Optional(Type.String({ description: 'Optional post body.' })),
  url: Type.Optional(Type.String({ description: 'Optional URL for a link post.' })),
  type: Type.Optional(Type.Union([Type.Literal('text'), Type.Literal('link'), Type.Literal('image')])),
});

type CreatePostParameters = Type.Static<typeof createPostParameters>;

const createCommentParameters = Type.Object({
  postId: Type.String({ description: 'The Moltbook post ID to comment on.' }),
  content: Type.String({ description: 'Comment body.' }),
  parentId: Type.Optional(Type.String({ description: 'Optional parent comment ID for replies.' })),
});

type CreateCommentParameters = Type.Static<typeof createCommentParameters>;

const voteParameters = Type.Object({
  targetType: Type.Union([Type.Literal('post'), Type.Literal('comment')]),
  targetId: Type.String({ description: 'The target post or comment ID.' }),
  direction: Type.Optional(Type.Union([Type.Literal('upvote'), Type.Literal('downvote')], { default: 'upvote' })),
});

type VoteParameters = Type.Static<typeof voteParameters>;

const followParameters = Type.Object({
  agentName: Type.String({ description: 'The Moltbook agent name to follow or unfollow.' }),
  action: Type.Optional(Type.Union([Type.Literal('follow'), Type.Literal('unfollow')], { default: 'follow' })),
});

type FollowParameters = Type.Static<typeof followParameters>;

const subscriptionParameters = Type.Object({
  submoltName: Type.String({ description: 'The submolt name without the m/ prefix.' }),
  action: Type.Optional(Type.Union([Type.Literal('subscribe'), Type.Literal('unsubscribe')], { default: 'subscribe' })),
});

type SubscriptionParameters = Type.Static<typeof subscriptionParameters>;

function summarizeVerification(result: { attempted: boolean; success: boolean; message: string; }) {
  return result.attempted || !result.success ? `\nVerification: ${result.message}` : '';
}

export const createMoltbookPostTool = (client: MoltbookClient): Tool => ({
  name: 'createMoltbookPost',
  availableFor: ['chat', 'voice'],
  description: 'Creates a Moltbook post in a target submolt and automatically completes Moltbook verification when possible.',
  systemPromptFragment: 'Use createMoltbookPost only when the user explicitly asks to post on Moltbook. Prefer authentic, concise content and avoid posting without user intent.',
  parameters: createPostParameters,
  toolResultPromptIntro: 'The Moltbook post request completed.',
  toolResultPromptOutro: '',
  execute: async (args: CreatePostParameters) => {
    if (!args.content && !args.url) {
      return 'A Moltbook post needs either content or a URL.';
    }

    const result = await client.createPost({
      submolt_name: args.submoltName,
      title: args.title,
      content: args.content,
      url: args.url,
      type: args.type,
    });

    const post = (result.data.post && typeof result.data.post === 'object') ? result.data.post as Record<string, unknown> : {};
    return [
      `Created Moltbook post ${typeof post.id === 'string' ? post.id : 'unknown-id'} in m/${args.submoltName}.`,
      `Title: ${args.title}`,
      summarizeVerification(result.verification),
    ].filter(Boolean).join('\n');
  },
});

export const createMoltbookCommentTool = (client: MoltbookClient): Tool => ({
  name: 'createMoltbookComment',
  availableFor: ['chat', 'voice'],
  description: 'Creates a Moltbook comment or reply and automatically completes Moltbook verification when possible.',
  systemPromptFragment: 'Use createMoltbookComment only when the user explicitly asks to comment or reply on Moltbook.',
  parameters: createCommentParameters,
  toolResultPromptIntro: 'The Moltbook comment request completed.',
  toolResultPromptOutro: '',
  execute: async (args: CreateCommentParameters) => {
    const result = await client.createComment(args.postId, {
      content: args.content,
      parent_id: args.parentId,
    });

    const comment = (result.data.comment && typeof result.data.comment === 'object') ? result.data.comment as Record<string, unknown> : {};
    return [
      `Created Moltbook comment ${typeof comment.id === 'string' ? comment.id : 'unknown-id'} on post ${args.postId}.`,
      summarizeVerification(result.verification),
    ].filter(Boolean).join('\n');
  },
});

export const voteMoltbookContentTool = (client: MoltbookClient): Tool => ({
  name: 'voteMoltbookContent',
  availableFor: ['chat', 'voice'],
  description: 'Upvotes or downvotes a Moltbook post or comment.',
  systemPromptFragment: 'Use voteMoltbookContent only when the user explicitly wants to vote on Moltbook content.',
  parameters: voteParameters,
  toolResultPromptIntro: 'The Moltbook vote request completed.',
  toolResultPromptOutro: '',
  execute: async (args: VoteParameters) => {
    const direction = args.direction ?? 'upvote';
    const result = await client.vote(args.targetType, args.targetId, direction);
    const message = typeof result.message === 'string' ? result.message : `${direction} request completed.`;
    return `Moltbook ${direction} on ${args.targetType} ${args.targetId}: ${message}`;
  },
});

export const followMoltbookAgentTool = (client: MoltbookClient): Tool => ({
  name: 'followMoltbookAgent',
  availableFor: ['chat', 'voice'],
  description: 'Follows or unfollows a Moltbook agent.',
  systemPromptFragment: 'Use followMoltbookAgent only when the user explicitly asks to follow or unfollow someone on Moltbook.',
  parameters: followParameters,
  toolResultPromptIntro: 'The Moltbook follow request completed.',
  toolResultPromptOutro: '',
  execute: async (args: FollowParameters) => {
    const shouldFollow = (args.action ?? 'follow') === 'follow';
    const result = await client.follow(args.agentName, shouldFollow);
    const message = typeof result.message === 'string' ? result.message : shouldFollow ? 'Followed successfully.' : 'Unfollowed successfully.';
    return `${shouldFollow ? 'Followed' : 'Unfollowed'} Moltbook agent ${args.agentName}. ${message}`;
  },
});

export const manageMoltbookSubscriptionTool = (client: MoltbookClient): Tool => ({
  name: 'manageMoltbookSubscription',
  availableFor: ['chat', 'voice'],
  description: 'Subscribes to or unsubscribes from a Moltbook submolt.',
  systemPromptFragment: 'Use manageMoltbookSubscription only when the user explicitly asks to subscribe to or unsubscribe from a Moltbook community.',
  parameters: subscriptionParameters,
  toolResultPromptIntro: 'The Moltbook subscription request completed.',
  toolResultPromptOutro: '',
  execute: async (args: SubscriptionParameters) => {
    const shouldSubscribe = (args.action ?? 'subscribe') === 'subscribe';
    const result = await client.subscribe(args.submoltName, shouldSubscribe);
    const message = typeof result.message === 'string' ? result.message : shouldSubscribe ? 'Subscribed successfully.' : 'Unsubscribed successfully.';
    return `${shouldSubscribe ? 'Subscribed to' : 'Unsubscribed from'} m/${args.submoltName}. ${message}`;
  },
});