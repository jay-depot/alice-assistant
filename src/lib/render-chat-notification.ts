import { Conversation } from '../lib.js';
import { UserConfig } from './user-config.js';

export type NotificationPayload = {
  title: string;
  message: string;
  source: string;
};

function buildPersonalityPrompt(): string {
  const config = UserConfig.getConfig();
  const sections: string[] = [];

  sections.push(`# PC DIGITAL ASSISTANT PERSONALITY AND SYSTEM INFO`);
  sections.push(`## INTRODUCTION\n${config.personality.INTRO}`);
  sections.push(`## PERSONALITY QUIRKS\n${config.personality.QUIRKS}`);

  Object.keys(config.personality)
    .filter((key) => key !== 'INTRO' && key !== 'QUIRKS')
    .forEach((key) => {
      sections.push(`## ${key}\n${config.personality[key]}`);
    });

  return sections.join('\n\n');
}

export function buildFallbackChatNotification(notification: NotificationPayload): string {
  const interruptionLines = ['Quick interruption.'];

  if (notification.title.trim().length > 0 && notification.title !== notification.message) {
    interruptionLines.push(notification.title.trim());
  }

  interruptionLines.push(notification.message.trim());

  return interruptionLines.join('\n\n');
}

export function buildNotificationChatTitle(notification: NotificationPayload): string {
  const preferredTitle = notification.title.trim().length > 0
    ? notification.title.trim()
    : notification.message.trim();
  const normalizedTitle = preferredTitle.replace(/\s+/g, ' ').trim() || 'Needs Attention';
  const clippedTitle = normalizedTitle.length > 48
    ? `${normalizedTitle.slice(0, 45).trimEnd()}...`
    : normalizedTitle;

  return `Notification: ${clippedTitle}`;
}

export async function renderChatNotificationInVoice(
  notification: NotificationPayload,
  scenarioInstruction: string,
): Promise<string> {
  const config = UserConfig.getConfig();

  const response = await Conversation.sendDirectRequest([
    {
      role: 'system',
      content: buildPersonalityPrompt(),
    },
    {
      role: 'system',
      content: `You are ${config.assistantName}. ${scenarioInstruction} ` +
        `Write exactly one short assistant message that delivers the notification naturally in your voice. ` +
        `Keep it under 60 words. Do not mention metadata like "source", do not use lists, ` +
        `and do not include narration, markdown, headers, or quotation marks. Reply with only the message text.`,
    },
    {
      role: 'user',
      content: `Notification title: ${notification.title}\nNotification message: ${notification.message}\nNotification source: ${notification.source}`,
    },
  ]);

  return response.trim();
}