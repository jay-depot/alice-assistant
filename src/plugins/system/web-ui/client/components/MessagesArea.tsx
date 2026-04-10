import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble.js';
import { RegionSlot } from './RegionSlot.js';
import { TypingIndicator } from './TypingIndicator.js';
import { WelcomeScreen } from './WelcomeScreen.js';
import type { Message } from '../types/index.js';

interface MessagesAreaProps {
  messages: Message[];
  showWelcome: boolean;
  isTyping: boolean;
}

export function MessagesArea({ messages, showWelcome, isTyping }: MessagesAreaProps) {
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [messages, isTyping, showWelcome]);

  return (
    <div id="messages-area" ref={messagesRef}>
      <RegionSlot region="message-prefix" />

      {showWelcome ? (
        <WelcomeScreen />
      ) : (
        messages.map((message, index) => (
          <MessageBubble key={`${message.timestamp}-${index}`} message={message} />
        ))
      )}

      {isTyping ? <TypingIndicator /> : null}

      <RegionSlot region="message-suffix" />
    </div>
  );
}
