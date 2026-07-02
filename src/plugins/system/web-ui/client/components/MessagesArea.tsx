import { useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import React from 'react';
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

function getAssistantTurnIdentityKey(
  content: string,
  reasoning?: string | null,
  senderName?: string | null
): string {
  return getMessageIdentityKey({
    role: 'assistant',
    content,
    reasoning,
    senderName,
  });
}

function getAssistantHandoffKey(
  content: string,
  senderName?: string | null
): string {
  return `${senderName ?? ''}:${content}`;
}

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

  // Handoff matching is intentionally looser than identity matching.
  // Reasoning text may differ between stream deltas and persisted rounds,
  // so we match recent assistant turns primarily by content + sender.
  const persistedAssistantHandoffKeys = useMemo(
    () =>
      new Set(
        visibleMessages
          .filter(
            message =>
              message.role === 'assistant' &&
              message.messageKind === 'chat' &&
              message.content.trim().length > 0
          )
          .slice(-10)
          .map(message =>
            getAssistantHandoffKey(message.content, message.senderName)
          )
      ),
    [visibleMessages]
  );

  const persistedToolCallsByBatchId = useMemo(() => {
    const batches = new Map<string, ToolCallData[]>();
    for (const message of visibleMessages) {
      if (
        message.messageKind !== 'tool_call' ||
        !message.toolCallData?.callBatchId
      ) {
        continue;
      }

      const batchId = message.toolCallData.callBatchId;
      const existing = batches.get(batchId) ?? [];
      existing.push(message.toolCallData);
      batches.set(batchId, existing);
    }
    return batches;
  }, [visibleMessages]);

  const getVisibleRealtimeBatchCalls = useCallback(
    (batchId: string, calls: ToolCallData[]): ToolCallData[] => {
      const persistedCalls = persistedToolCallsByBatchId.get(batchId) ?? [];
      if (persistedCalls.length === 0) {
        return calls;
      }

      const persistedCounts = new Map<string, number>();
      for (const call of persistedCalls) {
        const key = `${call.toolName}:${call.status}`;
        persistedCounts.set(key, (persistedCounts.get(key) ?? 0) + 1);
      }

      const visibleCalls: ToolCallData[] = [];
      for (const call of calls) {
        if (call.status === 'running') {
          visibleCalls.push(call);
          continue;
        }

        const key = `${call.toolName}:${call.status}`;
        const persistedRemaining = persistedCounts.get(key) ?? 0;
        if (persistedRemaining > 0) {
          persistedCounts.set(key, persistedRemaining - 1);
          continue;
        }

        visibleCalls.push(call);
      }

      return visibleCalls;
    },
    [persistedToolCallsByBatchId]
  );

  // Collect real-time tool call batches as a map for O(1) lookups.
  // We'll consume each batch when rendering its linked turn,
  // leaving only orphan batches (no linked turn) for the bottom.
  const realtimeBatches = useMemo(
    () => [...toolCallBatches.entries()],
    [toolCallBatches]
  );

  // Build a set of batch IDs already claimed by completed turns so
  // we don't render them again as orphans at the bottom.
  const turnBatchIds = useMemo(
    () =>
      new Set(
        completedTurns.map(t => t.callBatchId).filter(Boolean) as string[]
      ),
    [completedTurns]
  );

  const visibleCompletedTurns = useMemo(
    () =>
      completedTurns.filter(
        turn =>
          !persistedAssistantHandoffKeys.has(
            getAssistantHandoffKey(turn.content)
          )
      ),
    [completedTurns, persistedAssistantHandoffKeys]
  );

  // Suppress the handoff bubble once its content exists in persisted messages
  // (arrived via session_updated).
  const finalIdentityKey = getAssistantTurnIdentityKey(
    finalContent,
    finalReasoning
  );
  const isFinalPersisted =
    finalContent.length > 0 &&
    persistedAssistantHandoffKeys.has(getAssistantHandoffKey(finalContent));

  const pendingAssistantIdentityKey = pendingAssistantMessage
    ? getAssistantTurnIdentityKey(pendingAssistantMessage)
    : null;
  const hasVisibleTransientAssistantTurn =
    currentStreamTurn !== null || visibleCompletedTurns.length > 0 || !!finalContent;
  const shouldShowPendingAssistantMessage =
    pendingAssistantMessage !== null &&
    !hasVisibleTransientAssistantTurn &&
    toolCallBatches.size === 0 &&
    pendingAssistantIdentityKey !== null &&
    !persistedAssistantHandoffKeys.has(
      getAssistantHandoffKey(pendingAssistantMessage)
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
                key={`${getMessageKey(message)}:${segmentIndex}:${messageIndex}`}
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

          {/* ── Completed stream turns with interleaved tool-call batches ── */}
          {visibleCompletedTurns.map(turn => (
            <React.Fragment key={`completed-turn-${turn.turnIndex}`}>
              <StreamTurnContainer
                turn={turn}
                isCurrent={false}
                isComplete={true}
                expandedKeys={expandedMessageKeys}
                onSetExpanded={handleSetExpanded}
              />
              {/* Render the tool-call batch linked to this turn right after,
                  before the next turn's reasoning appears. */}
              {turn.callBatchId &&
              toolCallBatches.has(turn.callBatchId) &&
              getVisibleRealtimeBatchCalls(
                turn.callBatchId,
                toolCallBatches.get(turn.callBatchId)!
              ).length > 0 ? (
                <ToolCallBatch
                  calls={getVisibleRealtimeBatchCalls(
                    turn.callBatchId,
                    toolCallBatches.get(turn.callBatchId)!
                  )}
                />
              ) : null}
            </React.Fragment>
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
          {shouldShowPendingAssistantMessage ? (
            <MessageBubble
              message={{
                role: 'assistant',
                messageKind: 'chat',
                content: pendingAssistantMessage!,
                timestamp: '',
              }}
              isExpanded={
                pendingAssistantIdentityKey
                  ? expandedMessageKeys.has(pendingAssistantIdentityKey)
                  : false
              }
              onSetExpanded={handleSetExpanded}
            />
          ) : null}

          {/* ── Orphan tool call batches (not linked to any completed turn) ── */}
          {realtimeBatches
            .filter(
              ([batchId, calls]) =>
                !turnBatchIds.has(batchId) &&
                getVisibleRealtimeBatchCalls(batchId, calls).length > 0
            )
            .map(([batchId, calls]) => (
              <ToolCallBatch
                key={`realtime-${batchId}`}
                calls={getVisibleRealtimeBatchCalls(batchId, calls)}
              />
            ))}

          {/* ── Final content handoff bubble ──────────────────────────────
               Rendered after stream_done but before the persisted message
               arrives via session_updated. Suppressed once the persisted
               message is visible. ── */}
          {!isStreaming && finalContent && !isFinalPersisted ? (
            <MessageBubble
              message={{
                role: 'assistant',
                messageKind: 'chat',
                content: finalContent,
                reasoning: finalReasoning,
                timestamp: '',
              }}
              isExpanded={expandedMessageKeys.has(finalIdentityKey)}
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
