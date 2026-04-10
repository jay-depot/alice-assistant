import { formatTime } from '../utils.js';
import { classNames } from '../utils.js';
import type { Message } from '../types/index.js';
import { MarkdownHooks } from 'react-markdown';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <div className={classNames(
      'message',
      `message--${message.role}`,
      message.messageKind === 'notification' && 'message--notification',
    )}>
      {message.messageKind === 'notification' ? <div className="message__label">Notification</div> : null}
      <div className="message__bubble"><MarkdownHooks>{message.content}</MarkdownHooks></div>
      <div className="message__meta">{formatTime(message.timestamp)}</div>
    </div>
  );
}
