import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolCallData } from '../types/index.js';

type ToolCallEventType =
  | 'assistant_turn_started'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_error';

interface ToolCallEvent {
  type: ToolCallEventType;
  callBatchId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  assistantContent?: string;
  resultSummary?: string;
  error?: string;
  requiresApproval?: boolean;
  timestamp: string;
}

export function useToolCallEvents(
  sessionId: number | string | null,
  isProcessing: boolean
) {
  const [toolCallBatches, setToolCallBatches] = useState<
    Map<string, ToolCallData[]>
  >(new Map());
  const assistantTurnStartedRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const prevIsProcessingRef = useRef(false);

  // Clear all batches when processing transitions from true → false
  useEffect(() => {
    if (prevIsProcessingRef.current && !isProcessing) {
      setToolCallBatches(new Map());
      assistantTurnStartedRef.current = false;
    }
    prevIsProcessingRef.current = isProcessing;
  }, [isProcessing]);

  const handleEvent = useCallback((event: MessageEvent) => {
    const data: ToolCallEvent = JSON.parse(event.data);

    if (data.type === 'assistant_turn_started') {
      assistantTurnStartedRef.current = true;
      return;
    }

    if (
      !assistantTurnStartedRef.current ||
      !data.callBatchId ||
      !data.toolName
    ) {
      return;
    }

    setToolCallBatches(prev => {
      const next = new Map(prev);
      const batchCalls = next.get(data.callBatchId)
        ? [...next.get(data.callBatchId)!]
        : [];

      if (data.type === 'tool_call_started') {
        batchCalls.push({
          callBatchId: data.callBatchId,
          toolName: data.toolName,
          status: 'running',
          requiresApproval: data.requiresApproval,
        });
      } else {
        // Find the matching running entry by toolName and update it
        const entryIndex = batchCalls.findIndex(
          call => call.toolName === data.toolName && call.status === 'running'
        );
        if (entryIndex !== -1) {
          batchCalls[entryIndex] = {
            ...batchCalls[entryIndex],
            status: data.type === 'tool_call_completed' ? 'completed' : 'error',
            resultSummary: data.resultSummary,
            error: data.error,
          };
        }
      }

      next.set(data.callBatchId, batchCalls);
      return next;
    });
  }, []);

  // Open/close SSE connection based on session
  useEffect(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (sessionId === null) {
      return;
    }

    const eventSource = new EventSource(`/api/chat/${sessionId}/events`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener(
      'assistant_turn_started',
      handleEvent as EventListener
    );
    eventSource.addEventListener(
      'tool_call_started',
      handleEvent as EventListener
    );
    eventSource.addEventListener(
      'tool_call_completed',
      handleEvent as EventListener
    );
    eventSource.addEventListener(
      'tool_call_error',
      handleEvent as EventListener
    );

    eventSource.onerror = () => {
      // SSE will auto-reconnect; we just log for visibility
      console.debug('SSE connection error for session', sessionId);
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [sessionId, handleEvent]);

  return { toolCallBatches };
}
