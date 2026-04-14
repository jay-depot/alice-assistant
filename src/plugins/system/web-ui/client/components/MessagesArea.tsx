import { useLayoutEffect, useMemo, useRef } from 'react';
import { MessageBubble } from './MessageBubble.js';
import { ProcessingStatus } from './ProcessingStatus.js';
import { RegionSlot } from './RegionSlot.js';
import { WelcomeScreen } from './WelcomeScreen.js';
import { ToolCallBatch } from './ToolCallBatch.js';
import type { Message, ToolCallData } from '../types/index.js';
import { getMessageKey, isDisplayableMessage } from '../utils.js';

interface MessagesAreaProps {
  messages: Message[];
  showWelcome: boolean;
  isProcessing: boolean;
  isEndingSession: boolean;
  pendingMessageKey: string | null;
  lastReadMessageKey: string | null;
  toolCallBatches: Map<string, ToolCallData[]>;
  pendingAssistantMessage: string | null;
}

/** Group consecutive tool_call messages by callBatchId into batched segments. */
function groupToolCallMessages(
  messages: Message[]
): Array<
  | { type: 'messages'; items: Message[] }
  | { type: 'tool-batch'; calls: ToolCallData[] }
> {
  const segments: Array<
    | { type: 'messages'; items: Message[] }
    | { type: 'tool-batch'; calls: ToolCallData[] }
  > = [];
  let currentMessages: Message[] = [];
  let currentBatch: ToolCallData[] = [];
  let currentBatchId: string | null = null;

  const flushBatch = () => {
    if (currentBatch.length > 0) {
      segments.push({ type: 'tool-batch', calls: currentBatch });
      currentBatch = [];
      currentBatchId = null;
    }
  };

  const flushMessages = () => {
    if (currentMessages.length > 0) {
      segments.push({ type: 'messages', items: currentMessages });
      currentMessages = [];
    }
  };

  for (const message of messages) {
    if (message.messageKind === 'tool_call' && message.toolCallData) {
      const batchId = message.toolCallData.callBatchId;
      if (batchId !== currentBatchId) {
        flushMessages();
        flushBatch();
      }
      currentBatchId = batchId;
      currentBatch.push(message.toolCallData);
    } else {
      if (currentBatch.length > 0) {
        flushBatch();
      }
      currentMessages.push(message);
    }
  }

  flushMessages();
  flushBatch();

  return segments;
}

export function MessagesArea({
  messages,
  showWelcome,
  isProcessing,
  isEndingSession,
  pendingMessageKey,
  lastReadMessageKey,
  toolCallBatches,
  pendingAssistantMessage,
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

  const groupedSegments = useMemo(
    () => groupToolCallMessages(visibleMessages),
    [visibleMessages]
  );

  // Collect real-time tool call batches as an array for rendering
  const realtimeBatches = useMemo(
    () => [...toolCallBatches.entries()],
    [toolCallBatches]
  );

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
    toolCallBatches.size,
  ]);

  return (
    <div id="messages-area" ref={messagesRef}>
      <RegionSlot region="message-prefix" />

      {showWelcome ? (
        <WelcomeScreen />
      ) : (
        <>
          {groupedSegments.map((segment, segmentIndex) => {
            if (segment.type === 'tool-batch') {
              return (
                <ToolCallBatch
                  key={`batch-${segmentIndex}`}
                  calls={segment.calls}
                />
              );
            }

            return segment.items.map((message, messageIndex) => (
              <MessageBubble
                key={`${message.timestamp}-${segmentIndex}-${messageIndex}`}
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
            ));
          })}

          {/* Real-time pending assistant message (shown before tool calls stream in) */}
          {pendingAssistantMessage ? (
            <MessageBubble
              message={{
                role: 'assistant',
                messageKind: 'chat',
                content: pendingAssistantMessage,
                timestamp: '',
              }}
            />
          ) : null}

          {/* Real-time tool call batches (shown during processing) */}
          {realtimeBatches.map(([batchId, calls]) => (
            <ToolCallBatch key={`realtime-${batchId}`} calls={calls} />
          ))}
        </>
      )}

      {isProcessing ? <ProcessingStatus /> : null}
      {isEndingSession ? (
        <ProcessingStatus label="Archiving conversation..." />
      ) : null}

      <RegionSlot region="message-suffix" />
    </div>
  );
}
