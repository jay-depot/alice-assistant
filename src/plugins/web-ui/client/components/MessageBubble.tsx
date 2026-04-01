import { formatTime } from '../utils.js';
import type { Message } from '../types/index.js';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <div className={`message message--${message.role}`}>
      <div className="message__bubble">{message.content}</div>
      <div className="message__meta">{formatTime(message.timestamp)}</div>
    </div>
  );
}
