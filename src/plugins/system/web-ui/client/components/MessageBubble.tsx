import { formatTime } from '../utils.js';
import { classNames } from '../utils.js';
import type { Message } from '../types/index.js';
import { MarkdownHooks } from 'react-markdown';
import { ReadReceiptIcon } from './ReadReceiptIcon.js';

interface MessageBubbleProps {
  message: Message;
  receiptStatus?: 'sent' | 'read' | null;
}

export function MessageBubble({
  message,
  receiptStatus = null,
}: MessageBubbleProps) {
  return (
    <div
      className={classNames(
        'message',
        `message--${message.role}`,
        message.messageKind === 'notification' && 'message--notification'
      )}
    >
      {message.messageKind === 'notification' ? (
        <div className="message__label">Notification</div>
      ) : null}
      {message.role === 'assistant' && message.senderName ? (
        <div className="message__sender">{message.senderName}</div>
      ) : null}
      <div className="message__bubble">
        <MarkdownHooks>{message.content}</MarkdownHooks>
      </div>
      <div className="message__meta">
        <span>{formatTime(message.timestamp)}</span>
        {message.role === 'user' && receiptStatus ? (
          <span
            className={classNames(
              'message__status',
              receiptStatus === 'sent' && 'message__status--sent',
              receiptStatus === 'read' && 'message__status--read'
            )}
            aria-label={
              receiptStatus === 'read' ? 'Read by Alice' : 'Sent to Alice'
            }
          >
            <ReadReceiptIcon variant={receiptStatus} />
            <span>{receiptStatus === 'read' ? 'Read' : 'Sent'}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
