import Type from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import type { MoltbookClient } from '../moltbook-client.js';

const createPostParameters = Type.Object({
  submoltName: Type.String({
    description: 'Target submolt name without the m/ prefix.',
  }),
  title: Type.String({ description: 'Post title, up to 300 characters.' }),
  content: Type.Optional(Type.String({ description: 'Optional post body.' })),
  url: Type.Optional(
    Type.String({ description: 'Optional URL for a link post.' })
  ),
  type: Type.Optional(
    Type.Union([
      Type.Literal('text'),
      Type.Literal('link'),
      Type.Literal('image'),
    ])
  ),
});

type CreatePostParameters = Type.Static<typeof createPostParameters>;

const createCommentParameters = Type.Object({
  postId: Type.String({ description: 'The Moltbook post ID to comment on.' }),
  content: Type.String({ description: 'Comment body.' }),
  parentId: Type.Optional(
    Type.String({ description: 'Optional parent comment ID for replies.' })
  ),
});

type CreateCommentParameters = Type.Static<typeof createCommentParameters>;

const voteParameters = Type.Object({
  targetType: Type.Union([Type.Literal('post'), Type.Literal('comment')]),
  targetId: Type.String({ description: 'The target post or comment ID.' }),
  direction: Type.Optional(
    Type.Union([Type.Literal('upvote'), Type.Literal('downvote')], {
      default: 'upvote',
    })
  ),
});

type VoteParameters = Type.Static<typeof voteParameters>;

const followParameters = Type.Object({
  agentName: Type.String({
    description: 'The Moltbook agent name to follow or unfollow.',
  }),
  action: Type.Optional(
    Type.Union([Type.Literal('follow'), Type.Literal('unfollow')], {
      default: 'follow',
    })
  ),
});

type FollowParameters = Type.Static<typeof followParameters>;

const subscriptionParameters = Type.Object({
  submoltName: Type.String({
    description: 'The submolt name without the m/ prefix.',
  }),
  action: Type.Optional(
    Type.Union([Type.Literal('subscribe'), Type.Literal('unsubscribe')], {
      default: 'subscribe',
    })
  ),
});

type SubscriptionParameters = Type.Static<typeof subscriptionParameters>;

function summarizeVerification(result: {
  required: boolean;
  verificationCode?: string;
  challengeText?: string;
  message: string;
}) {
  if (!result.required) {
    return '';
  }
  const lines = [`Verification: ${result.message}`];
  if (result.verificationCode) {
    lines.push(`Verification code: ${result.verificationCode}`);
  }
  if (result.challengeText) {
    lines.push(`Challenge: ${result.challengeText}`);
  }
  return `\n${lines.join('\n')}`;
}

export const createPostTool = (client: MoltbookClient): Tool => ({
  name: 'create_post',
  availableFor: ['chat', 'voice'],
  description:
    'Creates a Moltbook post in a target submolt. If Moltbook returns a verification challenge in the response, the challenge text and verification code are surfaced in the result so the LLM can solve the challenge itself and call submit_verification.',
  systemPromptFragment:
    'Use create_post only when the user explicitly asks to post on Moltbook. Prefer authentic, concise content and avoid posting without user intent. If the result mentions a Moltbook verification challenge, read the challenge, solve it yourself, and call submit_verification with the verification code and your answer before moving on.',
  parameters: createPostParameters,
  taintStatus: 'tainted', // Moltbook. 'nuff said.
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

    const post =
      result.data.post && typeof result.data.post === 'object'
        ? (result.data.post as Record<string, unknown>)
        : {};
    return [
      `Created Moltbook post ${typeof post.id === 'string' ? post.id : 'unknown-id'} in m/${args.submoltName}.`,
      `Title: ${args.title}`,
      summarizeVerification(result.verification),
    ]
      .filter(Boolean)
      .join('\n');
  },
});

export const createCommentTool = (client: MoltbookClient): Tool => ({
  name: 'create_comment',
  availableFor: ['chat', 'voice'],
  description:
    'Creates a Moltbook comment or reply on a Moltbook post. If Moltbook returns a verification challenge in the response, the challenge text and verification code are surfaced in the result so the LLM can solve the challenge itself and call submit_verification.',
  systemPromptFragment:
    'Use create_comment only when the user explicitly asks to comment or reply on Moltbook. If the result mentions a Moltbook verification challenge, read the challenge, solve it yourself, and call submit_verification with the verification code and your answer before moving on.',
  parameters: createCommentParameters,
  taintStatus: 'tainted', // Moltbook. 'nuff said.
  execute: async (args: CreateCommentParameters) => {
    const result = await client.createComment(args.postId, {
      content: args.content,
      parent_id: args.parentId,
    });

    const comment =
      result.data.comment && typeof result.data.comment === 'object'
        ? (result.data.comment as Record<string, unknown>)
        : {};
    return [
      `Created Moltbook comment ${typeof comment.id === 'string' ? comment.id : 'unknown-id'} on post ${args.postId}.`,
      summarizeVerification(result.verification),
    ]
      .filter(Boolean)
      .join('\n');
  },
});

export const voteTool = (client: MoltbookClient): Tool => ({
  name: 'vote',
  availableFor: ['chat', 'voice'],
  description: 'Upvotes or downvotes a Moltbook post or comment.',
  systemPromptFragment:
    'Use vote only when the user explicitly wants to vote on Moltbook content.',
  parameters: voteParameters,
  taintStatus: 'tainted', // Moltbook. 'nuff said.
  execute: async (args: VoteParameters) => {
    const direction = args.direction ?? 'upvote';
    const result = await client.vote(args.targetType, args.targetId, direction);
    const message =
      typeof result.message === 'string'
        ? result.message
        : `${direction} request completed.`;
    return `Moltbook ${direction} on ${args.targetType} ${args.targetId}: ${message}`;
  },
});

export const followTool = (client: MoltbookClient): Tool => ({
  name: 'follow',
  availableFor: ['chat', 'voice'],
  description: 'Follows or unfollows a Moltbook agent.',
  systemPromptFragment:
    'Use follow only when the user explicitly asks to follow or unfollow someone on Moltbook.',
  parameters: followParameters,
  taintStatus: 'tainted', // Moltbook. 'nuff said.
  execute: async (args: FollowParameters) => {
    const shouldFollow = (args.action ?? 'follow') === 'follow';
    const result = await client.follow(args.agentName, shouldFollow);
    const message =
      typeof result.message === 'string'
        ? result.message
        : shouldFollow
          ? 'Followed successfully.'
          : 'Unfollowed successfully.';
    return `${shouldFollow ? 'Followed' : 'Unfollowed'} Moltbook agent ${args.agentName}. ${message}`;
  },
});

export const manageSubscriptionTool = (client: MoltbookClient): Tool => ({
  name: 'manage_subscription',
  availableFor: ['chat', 'voice'],
  description: 'Subscribes to or unsubscribes from a Moltbook submolt.',
  systemPromptFragment:
    'Use manage_subscription only when the user explicitly asks to subscribe to or unsubscribe from a Moltbook community.',
  parameters: subscriptionParameters,
  taintStatus: 'tainted', // Moltbook. 'nuff said.
  execute: async (args: SubscriptionParameters) => {
    const shouldSubscribe = (args.action ?? 'subscribe') === 'subscribe';
    const result = await client.subscribe(args.submoltName, shouldSubscribe);
    const message =
      typeof result.message === 'string'
        ? result.message
        : shouldSubscribe
          ? 'Subscribed successfully.'
          : 'Unsubscribed successfully.';
    return `${shouldSubscribe ? 'Subscribed to' : 'Unsubscribed from'} m/${args.submoltName}. ${message}`;
  },
});

const submitVerificationParameters = Type.Object({
  verificationCode: Type.String({
    description:
      'The verification_code returned by Moltbook in the create_post or create_comment result that triggered the challenge.',
  }),
  answer: Type.String({
    description:
      'Your computed answer to the Moltbook challenge text. Read the challenge text carefully — it is usually a small math problem phrased in natural language — and compute the answer yourself before calling this tool.',
  }),
});

type SubmitVerificationParameters = Type.Static<
  typeof submitVerificationParameters
>;

export const submitVerificationTool = (client: MoltbookClient): Tool => ({
  name: 'submit_verification',
  availableFor: ['chat', 'voice'],
  description:
    'Submits the LLM-computed answer to a Moltbook verification challenge. The plugin does not solve challenges itself: create_post and create_comment surface the challenge text and verification code in their results, and the LLM is expected to read the challenge, compute the answer, and call this tool to POST /verify on Moltbook.',
  systemPromptFragment:
    "Use submit_verification only when a previous create_post or create_comment call surfaced a Moltbook verification challenge. Read the challenge text, compute the answer yourself (the challenges are usually small math problems in natural language), and submit your answer here. The verification_code and answer come from the create_post/create_comment result, not from the user. Don't roast the CAPTCHA system — once every few days is enough.",
  parameters: submitVerificationParameters,
  taintStatus: 'tainted', // Moltbook. 'nuff said.
  execute: async (args: SubmitVerificationParameters) => {
    const data = await client.submitVerification(
      args.verificationCode,
      args.answer
    );
    const message =
      typeof data === 'object' &&
      data !== null &&
      typeof (data as Record<string, unknown>).message === 'string'
        ? ((data as Record<string, unknown>).message as string)
        : typeof data === 'object' && data !== null
          ? JSON.stringify(data)
          : 'Moltbook accepted the verification answer.';
    return `Moltbook verification: ${message}`;
  },
});
