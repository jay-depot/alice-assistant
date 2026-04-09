# Notifications Chat Interruption / Initiate Test Plan

## Goal

Validate the current notification-to-chat delivery paths for both `notifications-chat-interruption` and `notifications-chat-initiate`, including their different fallback behaviors and the web UI queueing guarantees.

## Current Intended Behavior

- `notifications-chat-interruption`
  - Reuses the most recently updated chat session if one exists.
  - Waits for any in-flight chat turn on that session to finish before appending the assistant message.
  - Falls back to creating a new assistant-only chat if no session exists.

- `notifications-chat-initiate`
  - Always creates a brand new assistant-only chat.
  - Does this even if another chat session already exists.

- Shared rendering path
  - Both plugins generate notification text through `src/lib/render-chat-notification.ts`.
  - If LLM rendering fails, both plugins fall back to a plain text notification message.

## Action Items

1. Verify interruption behavior with an existing active chat.
   - Enable `notifications-chat-interruption`.
   - Open a normal chat session in the web UI.
   - Trigger a notification while that chat exists.
   - Confirm the assistant message lands in the most recently updated chat rather than creating a second session.

2. Verify interruption fallback behavior with no existing chat.
   - Ensure no chat sessions are open or available.
   - Trigger a notification with `notifications-chat-interruption` enabled.
   - Confirm a new assistant-only chat is created and contains the delivered notification.

3. Verify initiate behavior with an existing chat.
   - Enable `notifications-chat-initiate`.
   - Keep at least one chat session open.
   - Trigger a notification.
   - Confirm a brand new assistant-only chat is created instead of reusing the active one.

4. Verify queueing while a chat turn is in progress.
   - Start a user message that triggers a slow or multi-tool assistant response.
   - Trigger a notification before that response finishes.
   - Confirm the queued interruption or append does not interleave into the middle of the server-side turn processing.
   - Confirm the notification message appears only after the active turn completes.

5. Verify frontend update detection.
   - Keep the target chat open in the browser.
   - Trigger an interruption while the page is idle.
   - Confirm the new assistant message appears without manual refresh.
   - Confirm the session list also updates to reflect the latest activity.

6. Verify LLM-rendered voice and fallback behavior.
   - Test once with normal Ollama access and confirm the inserted assistant message sounds like the configured personality.
   - Test once with the rendering path intentionally failing or unavailable and confirm the plain fallback message is still delivered.

7. Verify plugin interaction rules.
   - Check behavior with only `notifications-chat-interruption` enabled.
   - Check behavior with only `notifications-chat-initiate` enabled.
   - Check behavior with both enabled and confirm whether dual delivery is acceptable, confusing, or should be explicitly prevented later.

## Verification Notes

1. The most important correctness check is ordering: no notification message should be appended to a session before the current queued chat turn has finished.
2. The second most important check is session targeting:
   - interruption prefers latest existing chat, otherwise creates one
   - initiate always creates a new chat
3. Polling-based frontend refresh means a few seconds of delay is currently expected and should not be treated as failure by itself.

## Follow-up Questions

1. Should assistant-only chats created by `notifications-chat-initiate` or interruption fallback get a more descriptive title immediately instead of `New Conversation`? Answer: Now that you mention it, yes, they should.
2. Should the web UI visually distinguish notification-created assistant messages from normal replies? Answer: Yeah, that's a good idea too.
3. Should enabling both `notifications-chat-interruption` and `notifications-chat-initiate` eventually be treated as a configuration warning or hard conflict? Answer: A warning seems appropriate, but an error a little excessive. I could see someone doing it for the memes (Or legitimately because they just need that many bells going off to have any hope at task initiation? I won't judge.). Long-term (we're not doing this now) I'd like to get a plugin config panel into the web UI which will surface the "don't do this unless you *like* being annoyed" text in the descriptions more clearly anyway. For now, let's start a rough plan (more brainstorm) document for the plugin settings UI and include provisions for these kind of "soft conflict" warnings in it.
