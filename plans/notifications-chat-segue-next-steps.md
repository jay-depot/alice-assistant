# Notifications Chat Segue Next Steps

## Goal

Turn the first-pass `notifications-chat-segue` implementation into a tested, usable chat-delivery path for pending notifications.

## Action Items

1. Enable `notifications-chat-segue` locally and verify that a due reminder creates a persisted pending segue notification.
   - Update the local enabled plugin config to turn on `notifications-chat-segue`.
   - Start the assistant and create a reminder that becomes due immediately or within one minute.
   - Confirm the reminder is dispatched through `notifications-broker` and stored as a pending `NotificationsChatSegueNotification` row.
   - Confirm the reminder is not lost if `notifications-console` and `notifications-libnotify` are also enabled.

2. Tighten the segue prompt wording after one or two live chat runs.
   - Observe whether the assistant mentions pending notifications naturally in chat.
   - Check for failure modes such as repeating the same notification too often, dumping the full list verbatim, or ignoring pending items entirely.
   - Adjust the header prompt in `src/plugins/system/notifications-chat-segue/notifications-chat-segue.ts` so it nudges delivery without sounding robotic or repetitive.
   - Keep the prompt scoped to chat only.

3. Add an explicit pending-notifications read path if the user asks what is waiting.
   - Add a small read-only tool or equivalent mechanism so the assistant can answer questions like "what notifications are pending?" directly.
   - Reuse the same persisted notification records instead of building a second queue.
   - Decide whether this should be a dedicated tool or just stronger system-prompt guidance.

## Verification

1. Create a due reminder and confirm a pending segue notification record exists.
2. Open a chat session and confirm the assistant can naturally mention the notification.
3. Confirm `markNotificationsDelivered` changes the notification state so it no longer appears in subsequent prompt injections.
4. Confirm pending notifications remain available across assistant restarts until marked delivered.

## Notes

- Current implementation is intentionally first-pass and persistence-backed.
- `notifications-chat-segue` should remain disabled by default until end-to-end behavior feels stable.
- If prompt-driven delivery proves unreliable, the next escalation path is a dedicated user-visible notification listing tool rather than immediately jumping to interruption behavior.
