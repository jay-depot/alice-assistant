import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import { NotificationsChatSegueNotification } from './db-schemas/index.js';

const MarkNotificationsDeliveredParameters = Type.Object({
  notificationIds: Type.Array(Type.String(), {
    description:
      'The IDs of pending notifications that have already been clearly delivered to the user in conversation.',
  }),
});

const notificationsConversationPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-chat-segue',
    name: 'Notifications Chat Segue Plugin',
    brandColor: '#157619',
    description:
      'A notifications provider for the notifications-broker system plugin. Adds any ' +
      'active notifications to the system prompts for text chat for the assistant to work into ' +
      'conversation naturally. Also gives the assistant a tool for marking notifications delivered ' +
      'when it thinks it has done so in conversation.',
    version: 'LATEST',
    dependencies: [
      { id: 'notifications-broker', version: 'LATEST' },
      { id: 'memory', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { registerNotificationSink } = plugin.request(
      'notifications-broker'
    )!;
    const { registerDatabaseModels, onDatabaseReady } =
      plugin.request('memory')!;
    const awaitForOrm = onDatabaseReady(async orm => orm);

    registerDatabaseModels([NotificationsChatSegueNotification]);

    await registerNotificationSink('notifications-chat-segue', {
      sendNotification: async notification => {
        const orm = await awaitForOrm;
        const em = orm.em.fork();

        const notificationEntry = em.create(
          NotificationsChatSegueNotification,
          {
            title: notification.title,
            message: notification.message,
            source: notification.source,
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        );

        em.persist(notificationEntry);
        await em.flush();
      },
    });

    plugin.registerHeaderSystemPrompt({
      name: 'notificationsChatSegueHeader',
      weight: 50,
      getPrompt: async context => {
        if (context.conversationType !== 'chat') {
          return false;
        }

        if (
          !context ||
          !context.availableTools?.length ||
          !context.availableTools?.includes('markNotificationsDelivered')
        ) {
          return false;
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const pendingNotifications = await em.find(
          NotificationsChatSegueNotification,
          {
            status: 'pending',
          },
          {
            orderBy: { createdAt: 'ASC', id: 'ASC' },
            limit: 10,
          }
        );

        if (pendingNotifications.length === 0) {
          return false;
        }

        const notificationLines = pendingNotifications.map(
          notification =>
            `- ID ${notification.id} | ${notification.title} | from ${notification.source} | ${notification.message}`
        );

        return (
          `# PENDING NOTIFICATIONS\n\n` +
          `You have pending notifications that have not yet been delivered to the user in chat. ` +
          `If it fits naturally in your next response, work the relevant notification into conversation clearly and concisely. ` +
          `Do not dump this list verbatim unless the user asks what notifications are pending. ` +
          `After you have clearly delivered one or more of them, call markNotificationsDelivered with their IDs.\n\n` +
          `${notificationLines.join('\n')}`
        );
      },
    });

    plugin.registerTool({
      name: 'markNotificationsDelivered',
      availableFor: ['chat'],
      description:
        'Marks pending segue notifications as delivered after you have clearly mentioned them to the user in chat.',
      parameters: MarkNotificationsDeliveredParameters,
      systemPromptFragment:
        'Call markNotificationsDelivered only after you have already worked one or more pending notifications into the conversation clearly enough that the user has effectively received them.',
      toolResultPromptIntro:
        'You have updated the delivery state of pending chat notifications.',
      toolResultPromptOutro: '',
      execute: async args => {
        const { notificationIds } = args as { notificationIds: string[] };

        if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
          return 'No notification IDs were provided, so no notifications were marked as delivered.';
        }

        const parsedIds = notificationIds
          .map(id => Number.parseInt(id, 10))
          .filter(id => Number.isInteger(id));

        if (parsedIds.length === 0) {
          return 'None of the provided notification IDs were valid integers, so no notifications were updated.';
        }

        const orm = await awaitForOrm;
        const em = orm.em.fork();
        const notifications = await em.find(
          NotificationsChatSegueNotification,
          {
            id: { $in: parsedIds },
            status: 'pending',
          }
        );

        if (notifications.length === 0) {
          return `No pending notifications matched the provided IDs: ${notificationIds.join(', ')}`;
        }

        const now = new Date();
        notifications.forEach(notification => {
          notification.status = 'delivered';
          notification.updatedAt = now;
        });

        await em.flush();

        return `Marked ${notifications.length} notification(s) as delivered: ${notifications.map(notification => notification.id).join(', ')}`;
      },
    });
  },
};

export default notificationsConversationPlugin;
