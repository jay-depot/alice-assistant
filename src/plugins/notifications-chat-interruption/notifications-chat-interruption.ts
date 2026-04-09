import { AlicePlugin } from '../../lib.js';
import { buildFallbackChatNotification, buildNotificationChatTitle, renderChatNotificationInVoice } from '../../lib/render-chat-notification.js';

const notificationsChatInterruptionPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'notifications-chat-interruption',
    name: 'Notifications Chat Interruption Plugin',
    description: 'A plugin that inserts active notifications into the middle of the ' +
      'assistant\'s most recently active chat session as they are received. This *should* ' +
      'cause the assistant to proactively mention these reminders right away.',
    version: 'LATEST',
    dependencies: [
      { id: 'notifications-broker', version: 'LATEST' },
      { id: 'web-ui', version: 'LATEST' },
    ],
    required: false,
    system: true,
  },
  
  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { registerNotificationSink } = plugin.request('notifications-broker')!;
    const { queueAssistantMessage } = plugin.request('web-ui')!;

    await registerNotificationSink('notifications-chat-interruption', {
      sendNotification: async (notification) => {
        let interruptionText = buildFallbackChatNotification(notification);

        try {
          const renderedInterruption = await renderChatNotificationInVoice(
            notification,
            'You are inserting a brief interruption into an already-active text chat with the user.',
          );
          if (renderedInterruption.length > 0) {
            interruptionText = renderedInterruption;
          }
        } catch (error) {
          console.error('Notifications Chat Interruption: Failed to render interruption in assistant voice. Falling back to plain notification text.', error);
        }

        const sessionId = await queueAssistantMessage({
          content: interruptionText,
          title: buildNotificationChatTitle(notification),
          messageKind: 'notification',
          openNewChatIfNone: true,
        });

        console.log(`Notifications Chat Interruption: Delivered notification into chat session ${sessionId}.`);
      },
    });
  }
};

export default notificationsChatInterruptionPlugin;
