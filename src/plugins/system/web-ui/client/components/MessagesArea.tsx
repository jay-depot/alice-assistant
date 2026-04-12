import { useLayoutEffect, useMemo, useRef } from 'react';
import { MessageBubble } from './MessageBubble.js';
import { ProcessingStatus } from './ProcessingStatus.js';
import { RegionSlot } from './RegionSlot.js';
import { WelcomeScreen } from './WelcomeScreen.js';
import type { Message } from '../types/index.js';
import { getMessageKey, isDisplayableMessage } from '../utils.js';

interface MessagesAreaProps {
  messages: Message[];
  showWelcome: boolean;
  isProcessing: boolean;
  isEndingSession: boolean;
  pendingMessageKey: string | null;
  lastReadMessageKey: string | null;
}

export function MessagesArea({
  messages,
  showWelcome,
  isProcessing,
  isEndingSession,
  pendingMessageKey,
  lastReadMessageKey,
}: MessagesAreaProps) {
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const visibleMessages = useMemo(
    () => messages.filter(isDisplayableMessage),
    [messages]
  );
  const lastVisibleMessageKey =
    visibleMessages.length > 0
      ? getMessageKey(visibleMessages[visibleMessages.length - 1])
      : null;

  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;

    let frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    isEndingSession,
    isProcessing,
    lastVisibleMessageKey,
    showWelcome,
    visibleMessages.length,
  ]);

  return (
    <div id="messages-area" ref={messagesRef}>
      <RegionSlot region="message-prefix" />

      {showWelcome ? (
        <WelcomeScreen />
      ) : (
        visibleMessages.map((message, index) => (
          <MessageBubble
            key={`${message.timestamp}-${index}`}
            message={message}
            receiptStatus={
              message.role === 'user'
                ? getMessageKey(message) === lastReadMessageKey
                  ? 'read'
                  : getMessageKey(message) === pendingMessageKey
                    ? 'sent'
                    : null
                : null
            }
          />
        ))
      )}

      {isProcessing ? <ProcessingStatus /> : null}
      {isEndingSession ? (
        <ProcessingStatus label="Archiving conversation..." />
      ) : null}

      <RegionSlot region="message-suffix" />
    </div>
  );
}
