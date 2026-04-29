import { useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { MessageBubble } from './MessageBubble.js';
import { ProcessingStatus } from './ProcessingStatus.js';
import { RegionSlot } from './RegionSlot.js';
import { WelcomeScreen } from './WelcomeScreen.js';
import { ToolCallBatch } from './ToolCallBatch.js';
import { StreamTurnContainer } from './StreamTurnContainer.js';
import type { Message, ToolCallData } from '../types/index.js';
import type { StreamTurn } from '../hooks/useStreamingSession.js';
import {
  getMessageIdentityKey,
  getMessageKey,
  isDisplayableMessage,
} from '../utils.js';

interface MessagesAreaProps {
  messages: Message[];
  showWelcome: boolean;
  isProcessing: boolean;
  isEndingSession: boolean;
  pendingMessageKey: string | null;
  lastReadMessageKey: string | null;
  toolCallBatches: Map<string, ToolCallData[]>;
  pendingAssistantMessage: string | null;
  /** Completed stream turns rendered as collapsible containers. */
  completedTurns: StreamTurn[];
  /** The turn currently receiving deltas (null when not streaming). */
  currentStreamTurn: StreamTurn | null;
  /** Final assistant content from stream_done — rendered as a handoff bubble
   *  until the persisted message arrives via session_updated. */
  finalContent: string;
  /** Final assistant reasoning from stream_done. */
  finalReasoning: string | null;
  isStreaming: boolean;
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
  completedTurns,
  currentStreamTurn,
  finalContent,
  finalReasoning,
  isStreaming,
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

  // ── Expanded message keys (parent-managed so it survives stream→persisted) ─
  const [expandedMessageKeys, setExpandedMessageKeys] = useState<Set<string>>(
    new Set()
  );

  const handleSetExpanded = useCallback((key: string, expanded: boolean) => {
    setExpandedMessageKeys(prev => {
      const next = new Set(prev);
      if (expanded) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // ── Auto-scroll ────────────────────────────────────────────────────────

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
          {/* ── Persisted messages and tool-call batches ── */}
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
                    ? getMessageIdentityKey(message) === lastReadMessageKey
                      ? 'read'
                      : getMessageIdentityKey(message) === pendingMessageKey
                        ? 'sent'
                        : null
                    : null
                }
                isExpanded={expandedMessageKeys.has(
                  getMessageIdentityKey(message)
                )}
                onSetExpanded={handleSetExpanded}
              />
            ));
          })}

          {/* ── Completed stream turns (multi-turn blocks) ── */}
          {completedTurns.map(turn => (
            <StreamTurnContainer
              key={`completed-turn-${turn.turnIndex}`}
              turn={turn}
              isCurrent={false}
              isComplete={true}
              expandedKeys={expandedMessageKeys}
              onSetExpanded={handleSetExpanded}
            />
          ))}

          {/* ── Current stream turn (receiving deltas) ── */}
          {currentStreamTurn ? (
            <StreamTurnContainer
              key={`current-turn-${currentStreamTurn.turnIndex}`}
              turn={currentStreamTurn}
              isCurrent={true}
              isComplete={currentStreamTurn.isComplete}
              expandedKeys={expandedMessageKeys}
              onSetExpanded={handleSetExpanded}
            />
          ) : null}

          {/* ── Real-time pending assistant message (before tool calls stream in) ── */}
          {pendingAssistantMessage ? (
            <MessageBubble
              message={{
                role: 'assistant',
                messageKind: 'chat',
                content: pendingAssistantMessage,
                timestamp: '',
              }}
              isExpanded={expandedMessageKeys.has(
                getMessageIdentityKey({
                  role: 'assistant',
                  content: pendingAssistantMessage,
                })
              )}
              onSetExpanded={handleSetExpanded}
            />
          ) : null}

          {/* ── Real-time tool call batches ── */}
          {realtimeBatches.map(([batchId, calls]) => (
            <ToolCallBatch key={`realtime-${batchId}`} calls={calls} />
          ))}

          {/* ── Final content handoff bubble ──────────────────────────────
               Rendered after stream_done but before the persisted message
               arrives via session_updated. Shares the same identity key
               as the persisted message, so expanded state survives. ── */}
          {!isStreaming && finalContent ? (
            <MessageBubble
              message={{
                role: 'assistant',
                messageKind: 'chat',
                content: finalContent,
                reasoning: finalReasoning,
                timestamp: '',
              }}
              isExpanded={expandedMessageKeys.has(
                getMessageIdentityKey({
                  role: 'assistant',
                  content: finalContent,
                })
              )}
              onSetExpanded={handleSetExpanded}
            />
          ) : null}
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
