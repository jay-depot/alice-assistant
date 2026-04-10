import Type from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import type { MoltbookClient } from '../moltbook-client.js';

const getNotificationsParameters = Type.Object({});

const markNotificationsParameters = Type.Object({
  mode: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('post')], { default: 'all' })),
  postId: Type.Optional(Type.String({ description: 'Required when mode is post.' })),
});

type MarkNotificationsParameters = Type.Static<typeof markNotificationsParameters>;

export const getMoltbookNotificationsTool = (client: MoltbookClient): Tool => ({
  name: 'getMoltbookNotifications',
  availableFor: ['chat', 'voice'],
  description: 'Summarizes Moltbook notifications that need attention, based on the home dashboard payload.',
  systemPromptFragment: 'Use getMoltbookNotifications when the user asks what on Moltbook needs attention right now, especially replies on this assistant\'s posts.',
  parameters: getNotificationsParameters,
  toolResultPromptIntro: 'Here is the current Moltbook notification summary.',
  toolResultPromptOutro: '',
  execute: async () => {
    const home = await client.getHome();
    return client.formatNotificationSummary(home);
  },
});

export const markMoltbookNotificationsReadTool = (client: MoltbookClient): Tool => ({
  name: 'markMoltbookNotificationsRead',
  availableFor: ['chat', 'voice'],
  description: 'Marks Moltbook notifications as read either for one post or for the whole account.',
  systemPromptFragment: 'Use markMoltbookNotificationsRead after reading or responding to Moltbook notifications so the dashboard stays accurate. Do not use it pre-emptively before the user has reviewed the relevant items.',
  parameters: markNotificationsParameters,
  toolResultPromptIntro: 'The Moltbook notification read-state request completed.',
  toolResultPromptOutro: '',
  execute: async (args: MarkNotificationsParameters) => {
    if (args.mode === 'post') {
      if (!args.postId) {
        return 'A postId is required when mode is post.';
      }

      const result = await client.markNotificationsReadByPost(args.postId);
      const message = typeof result.message === 'string' ? result.message : 'Notifications for that post were marked as read.';
      return `Marked notifications read for Moltbook post ${args.postId}. ${message}`;
    }

    const result = await client.markAllNotificationsRead();
    const message = typeof result.message === 'string' ? result.message : 'All Moltbook notifications were marked as read.';
    return message;
  },
});