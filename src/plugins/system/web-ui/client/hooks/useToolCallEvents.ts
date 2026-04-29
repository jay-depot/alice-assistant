import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, ToolCallData } from '../types/index.js';
import type { WsToolCallEvent } from '../../ws-types.js';
import { useWebSocket } from './useWebSocket.js';

export function useToolCallEvents(
  sessionId: number | string | null,
  isProcessing: boolean,
  messages: Message[]
) {
  const [toolCallBatches, setToolCallBatches] = useState<
    Map<string, ToolCallData[]>
  >(new Map());
  const [pendingAssistantMessage, setPendingAssistantMessage] = useState<
    string | null
  >(null);
  const [agentMonologue, setAgentMonologue] = useState<Map<string, string>>(
    new Map()
  );
  const assistantTurnStartedRef = useRef(false);
  const prevIsProcessingRef = useRef(false);

  // ── Dedup: remove real-time batches already persisted in messages ──────
  // Must run BEFORE the clearing effect below so batches already represented
  // in the persisted messages are removed from the live display first; the
  // clearing effect then sweeps up whatever is left.
  useEffect(() => {
    const persistedBatchIds = new Set(
      messages
        .filter(
          m => m.messageKind === 'tool_call' && m.toolCallData?.callBatchId
        )
        .map(m => m.toolCallData!.callBatchId)
    );
    if (persistedBatchIds.size === 0) return;

    setToolCallBatches(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const batchId of persistedBatchIds) {
        if (next.has(batchId)) {
          next.delete(batchId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [messages]);

  // ── Clear all batches when processing transitions true → false ────────
  useEffect(() => {
    if (prevIsProcessingRef.current && !isProcessing) {
      setToolCallBatches(new Map());
      setPendingAssistantMessage(null);
      assistantTurnStartedRef.current = false;
    }
    prevIsProcessingRef.current = isProcessing;
  }, [isProcessing]);

  const handleEvent = useCallback((event: WsToolCallEvent) => {
    if (event.type === 'assistant_turn_started') {
      assistantTurnStartedRef.current = true;
      // Don't show agent internal turns as pending messages in the main chat;
      // instead surface the last line in the ActiveAgentsPanel.
      if (event.agentInstanceId && event.assistantContent) {
        const lastLine = event.assistantContent
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean)
          .at(-1);
        if (lastLine) {
          setAgentMonologue(prev => {
            const next = new Map(prev);
            next.set(event.agentInstanceId!, lastLine);
            return next;
          });
        }
      } else if (
        !event.agentInstanceId &&
        event.assistantContent &&
        event.assistantContent.trim().length > 0
      ) {
        setPendingAssistantMessage(event.assistantContent);
      }
      return;
    }

    if (
      !assistantTurnStartedRef.current ||
      !event.callBatchId ||
      !event.toolName
    ) {
      return;
    }

    setToolCallBatches(prev => {
      const next = new Map(prev);
      const batchCalls = next.get(event.callBatchId!)
        ? [...next.get(event.callBatchId!)!]
        : [];

      if (event.type === 'tool_call_started') {
        batchCalls.push({
          callBatchId: event.callBatchId!,
          toolName: event.toolName!,
          status: 'running',
          requiresApproval: event.requiresApproval,
          taskAssistantId: event.taskAssistantId,
          agentName: event.agentName,
        });
      } else {
        // Find the matching running entry by toolName and update it
        const entryIndex = batchCalls.findIndex(
          call => call.toolName === event.toolName && call.status === 'running'
        );
        if (entryIndex !== -1) {
          batchCalls[entryIndex] = {
            ...batchCalls[entryIndex],
            status:
              event.type === 'tool_call_completed' ? 'completed' : 'error',
            resultSummary: event.resultSummary,
            error: event.error,
          };
        }
      }

      next.set(event.callBatchId!, batchCalls);
      return next;
    });
  }, []);

  const { subscribe } = useWebSocket();

  // Subscribe to WS tool-call events filtered to the current session
  useEffect(() => {
    if (sessionId === null) {
      return;
    }

    const numericSessionId =
      typeof sessionId === 'string' ? parseInt(sessionId) : sessionId;

    return subscribe(msg => {
      if (
        msg.type !== 'tool_call_event' ||
        msg.sessionId !== numericSessionId
      ) {
        return;
      }
      handleEvent(msg.event);
    });
  }, [sessionId, handleEvent, subscribe]);

  return { toolCallBatches, pendingAssistantMessage, agentMonologue };
}
