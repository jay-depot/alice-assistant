import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  formatTime,
  classNames,
  normalizeCssToken,
  getMessageIdentityKey,
} from '../utils.js';
import { humanizeToolName } from '../utils/tool-call-batch.js';
import type { Message } from '../types/index.js';
import { useEffect, useState } from 'react';
import { ReadReceiptIcon } from './ReadReceiptIcon.js';
import { ThinkingBlock } from './ThinkingBlock.js';

interface MessageBubbleProps {
  message: Message;
  receiptStatus?: 'sent' | 'read' | null;
  /** When provided, the expanded state is controlled by the parent
   *  (e.g. MessagesArea) so it survives streaming→persisted handoff.
   *  If omitted the component manages its own internal state. */
  isExpanded?: boolean;
  onSetExpanded?: (key: string, expanded: boolean) => void;
}

const LONG_MESSAGE_CHAR_THRESHOLD = 1200;
const LONG_MESSAGE_LINE_THRESHOLD = 14;

export function MessageBubble({
  message,
  receiptStatus = null,
  isExpanded: isExpandedProp,
  onSetExpanded,
}: MessageBubbleProps) {
  // Always declare the state hook — conditionally wire it to parent or
  // internal management below.
  const [selfExpanded, setSelfExpanded] = useState(false);

  const agentClassToken =
    message.role === 'assistant' && message.senderName
      ? `agent--${normalizeCssToken(message.senderName)}`
      : null;

  const lineCount = message.content.split('\n').length;
  const isLongMessage =
    message.content.length >= LONG_MESSAGE_CHAR_THRESHOLD ||
    lineCount >= LONG_MESSAGE_LINE_THRESHOLD;

  // Determine effective expanded state and setter:
  //  Parent-managed → use props, fire callback on toggle.
  //  Self-managed   → use internal useState.
  const isExpanded = onSetExpanded ? (isExpandedProp ?? false) : selfExpanded;

  const identityKey = getMessageIdentityKey(message);

  const setExpanded = (open: boolean) => {
    if (onSetExpanded) {
      onSetExpanded(identityKey, open);
    } else {
      setSelfExpanded(open);
    }
  };

  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpanded, onSetExpanded, identityKey]);

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
        {message.timestamp ? (
          <div className="message__meta">
            <span>{formatTime(message.timestamp)}</span>
          </div>
        ) : null}
      </div>
    );
  }

  const isStreaming = message.timestamp === '';

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
      {message.role === 'assistant' && message.reasoning ? (
        <ThinkingBlock content={message.reasoning} isThinking={isStreaming} />
      ) : null}
      <div
        className={classNames(
          'message__bubble',
          agentClassToken,
          isLongMessage && 'message__bubble--preview'
        )}
      >
        <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
      </div>
      {isLongMessage ? (
        <button
          type="button"
          className={classNames('message__expand', agentClassToken)}
          onClick={() => setExpanded(true)}
        >
          Open full message
        </button>
      ) : null}
      <div className="message__meta">
        {message.timestamp ? (
          <span>{formatTime(message.timestamp)}</span>
        ) : null}
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
          onClick={() => setExpanded(false)}
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
                onClick={() => setExpanded(false)}
              >
                Close
              </button>
            </div>
            <div className={classNames('message-modal__body', agentClassToken)}>
              <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
