import { AlicePlugin } from '../../../lib.js';
import {
  buildFallbackChatNotification,
  buildNotificationChatTitle,
  renderChatNotificationInVoice,
} from '../../../lib/render-chat-notification.js';

const notificationsChatInterruptionPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-chat-interruption',
    name: 'Notifications Chat Interruption Plugin',
    brandColor: '#7a4d6e',
    description:
      'A plugin that inserts active notifications into the middle of the ' +
      "assistant's most recently active chat session as they are received. This *should* " +
      'cause the assistant to proactively mention these reminders right away.',
    version: 'LATEST',
    dependencies: [
      { id: 'notifications-broker', version: 'LATEST' },
      { id: 'web-ui', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { registerNotificationSink } = plugin.request(
      'notifications-broker'
    )!;
    const { resolveTargetChatSession, queueAssistantMessageToSession } =
      plugin.request('web-ui')!;

    await registerNotificationSink('notifications-chat-interruption', {
      sendNotification: async notification => {
        const sessionId = await resolveTargetChatSession({
          title: buildNotificationChatTitle(notification),
          openNewChatIfNone: true,
        });

        if (sessionId === null) {
          plugin.logger.warn(
            'Notifications Chat Interruption: Could not resolve a target chat session for notification delivery.'
          );
          return;
        }

        let interruptionText = buildFallbackChatNotification(notification);

        try {
          const renderedInterruption = await renderChatNotificationInVoice(
            notification,
            'You are inserting a brief interruption into an already-active text chat with the user.',
            sessionId
          );
          if (renderedInterruption.length > 0) {
            interruptionText = renderedInterruption;
          }
        } catch (error) {
          plugin.logger.error(
            'Notifications Chat Interruption: Failed to render interruption in assistant voice. Falling back to plain notification text.',
            error
          );
        }

        await queueAssistantMessageToSession(sessionId, {
          content: interruptionText,
          messageKind: 'notification',
        });

        plugin.logger.log(
          `Notifications Chat Interruption: Delivered notification into chat session ${sessionId}.`
        );
      },
    });
  },
};

export default notificationsChatInterruptionPlugin;
