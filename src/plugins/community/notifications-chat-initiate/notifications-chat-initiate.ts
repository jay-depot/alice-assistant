import { AlicePlugin } from '../../../lib.js';
import { buildFallbackChatNotification, buildNotificationChatTitle, renderChatNotificationInVoice } from '../../../lib/render-chat-notification.js';

const notificationsConversationInitiatePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-chat-initiate',
    name: 'Notifications Chat Initiate Plugin',
    description: 'A plugin that initiates a chat session with the assistant when new notifications ' +
      'are received. It is similar to the notifications-chat-segue plugin but instead of just adding ' +
      'notifications to the system prompt, it actively starts a chat session with the assistant to ' +
      'inform it of the new notification and allow it to deliver them immediately. You probably don\'t ' +
      'want both this and notifications-chat-segue enabled simultaneously. It will *work* but you ' +
      'will be annoyed.',
    version: 'LATEST',
    dependencies: [
      { id: 'notifications-broker', version: 'LATEST' },
      { id: 'web-ui', version: 'LATEST' },
    ],
    required: false,
  },
  
  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { registerNotificationSink } = plugin.request('notifications-broker')!;
    const { resolveTargetChatSession, queueAssistantMessageToSession } = plugin.request('web-ui')!;

    await registerNotificationSink('notifications-chat-initiate', {
      sendNotification: async (notification) => {
        const sessionTitle = buildNotificationChatTitle(notification);
        const sessionId = await resolveTargetChatSession({
          title: sessionTitle,
          alwaysOpenNewChat: true,
        });

        if (sessionId === null) {
          console.warn('Notifications Chat Initiate: Could not resolve a target chat session for notification delivery.');
          return;
        }

        let messageText = buildFallbackChatNotification(notification);

        try {
          const renderedMessage = await renderChatNotificationInVoice(
            notification,
            'You are starting a text chat with the user because a notification needs their attention right now.',
            sessionId,
          );
          if (renderedMessage.length > 0) {
            messageText = renderedMessage;
          }
        } catch (error) {
          console.error('Notifications Chat Initiate: Failed to render notification in assistant voice. Falling back to plain notification text.', error);
        }

        await queueAssistantMessageToSession(sessionId, {
          content: messageText,
          messageKind: 'notification',
        });

        console.log(`Notifications Chat Initiate: Delivered notification into chat session ${sessionId}.`);
      },
    });
  }
};

export default notificationsConversationInitiatePlugin;
