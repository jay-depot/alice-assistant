import { formatTime } from '../utils.js';
import { classNames } from '../utils.js';
import { normalizeCssToken } from '../utils.js';
import { humanizeToolName } from '../utils/tool-call-batch.js';
import type { Message } from '../types/index.js';
import { useEffect, useState } from 'react';
import { MarkdownHooks } from 'react-markdown';
import { ReadReceiptIcon } from './ReadReceiptIcon.js';

interface MessageBubbleProps {
  message: Message;
  receiptStatus?: 'sent' | 'read' | null;
}

const LONG_MESSAGE_CHAR_THRESHOLD = 1200;
const LONG_MESSAGE_LINE_THRESHOLD = 14;

export function MessageBubble({
  message,
  receiptStatus = null,
}: MessageBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const agentClassToken =
    message.role === 'assistant' && message.senderName
      ? `agent--${normalizeCssToken(message.senderName)}`
      : null;

  const lineCount = message.content.split('\n').length;
  const isLongMessage =
    message.content.length >= LONG_MESSAGE_CHAR_THRESHOLD ||
    lineCount >= LONG_MESSAGE_LINE_THRESHOLD;

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExpanded(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isExpanded]);

  // Tool call messages render as a compact inline indicator
  if (message.messageKind === 'tool_call' && message.toolCallData) {
    const { toolCallData } = message;
    const statusIcon =
      toolCallData.status === 'completed' ? (
        <span className="tool-call-indicator__check" aria-label="Completed">
          ✓
        </span>
      ) : toolCallData.status === 'error' ? (
        <span className="tool-call-indicator__error-icon" aria-label="Error">
          ✗
        </span>
      ) : (
        <span className="tool-call-indicator__spinner" aria-label="Running" />
      );

    return (
      <div
        className={classNames(
          'message',
          'message--tool-call',
          `message--${message.role}`,
          `tool-call-indicator`,
          `tool-call-indicator--${toolCallData.status}`
        )}
      >
        <div className="tool-call-indicator__header">
          {statusIcon}
          <span className="tool-call-indicator__name">
            {humanizeToolName(toolCallData.toolName)}
          </span>
          {toolCallData.requiresApproval ? (
            <span
              className="tool-call-indicator__approval-badge"
              aria-label="Requires approval"
              title="Requires approval"
            >
              🔒
            </span>
          ) : null}
        </div>
        {toolCallData.status === 'completed' && toolCallData.resultSummary ? (
          <div className="tool-call-indicator__result">
            {toolCallData.resultSummary}
          </div>
        ) : null}
        {toolCallData.status === 'error' && toolCallData.error ? (
          <div className="tool-call-indicator__error">{toolCallData.error}</div>
        ) : null}
        <div className="message__meta">
          <span>{formatTime(message.timestamp)}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={classNames(
        'message',
        `message--${message.role}`,
        message.messageKind === 'notification' && 'message--notification'
      )}
    >
      {message.messageKind === 'notification' ? (
        <div className="message__label label--notification">Notification</div>
      ) : null}
      {message.role === 'assistant' && message.senderName ? (
        <div className={classNames('message__sender-badge', agentClassToken)}>
          <div
            className={classNames(
              'message__sender',
              `sender--${agentClassToken}`
            )}
          >
            {message.senderName}
          </div>
        </div>
      ) : null}
      <div
        className={classNames(
          'message__bubble',
          agentClassToken,
          isLongMessage && 'message__bubble--preview'
        )}
      >
        <MarkdownHooks>{message.content}</MarkdownHooks>
      </div>
      {isLongMessage ? (
        <button
          type="button"
          className={classNames('message__expand', agentClassToken)}
          onClick={() => setIsExpanded(true)}
        >
          Open full message
        </button>
      ) : null}
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
      {isExpanded ? (
        <div
          className={classNames('message-modal', agentClassToken)}
          role="dialog"
          aria-modal="true"
          aria-label="Full message"
          onClick={() => setIsExpanded(false)}
        >
          <div
            className={classNames(
              'message-modal__panel',
              `message-modal__panel--${message.role}`,
              message.messageKind === 'notification' &&
                'message-modal__panel--notification',
              agentClassToken
            )}
            onClick={event => event.stopPropagation()}
          >
            <div className="message-modal__header">
              <div className="message-modal__title">Full Message</div>
              <button
                type="button"
                className="message-modal__close"
                onClick={() => setIsExpanded(false)}
              >
                Close
              </button>
            </div>
            <div className={classNames('message-modal__body', agentClassToken)}>
              <MarkdownHooks>{message.content}</MarkdownHooks>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
