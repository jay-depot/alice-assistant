import { formatTime } from '../utils.js';
import type { Message } from '../types/index.js';
import { MarkdownHooks } from 'react-markdown';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <div className={`message message--${message.role}`}>
      <div className="message__bubble"><MarkdownHooks>{message.content}</MarkdownHooks></div>
      <div className="message__meta">{formatTime(message.timestamp)}</div>
    </div>
  );
}
