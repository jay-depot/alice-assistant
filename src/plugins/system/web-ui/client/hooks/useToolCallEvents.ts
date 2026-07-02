import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolCallData } from '../types/index.js';
import type { WsToolCallEvent } from '../../ws-types.js';
import { useWebSocket } from './useWebSocket.js';

export function useToolCallEvents(sessionId: number | string | null) {
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
      // eslint-disable-next-line no-useless-assignment -- Set a baseline default of false that holds even if this function is updated
      let didChange = false;

      if (event.type === 'tool_call_started') {
        const toolOrdinal = batchCalls.filter(
          call => call.toolName === event.toolName
        ).length;
        batchCalls.push({
          callBatchId: event.callBatchId!,
          clientCallKey: `${event.callBatchId}:${event.toolName}:${toolOrdinal}`,
          toolName: event.toolName!,
          status: 'running',
          requiresApproval: event.requiresApproval,
          taskAssistantId: event.taskAssistantId,
          agentName: event.agentName,
        });
        didChange = true;
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
          didChange = true;
        } else {
          // If completion/error arrives before started due WS timing,
          // synthesize the row so the UI does not drop the call.
          const toolOrdinal = batchCalls.filter(
            call => call.toolName === event.toolName
          ).length;
          batchCalls.push({
            callBatchId: event.callBatchId!,
            clientCallKey: `${event.callBatchId}:${event.toolName}:${toolOrdinal}`,
            toolName: event.toolName!,
            status:
              event.type === 'tool_call_completed' ? 'completed' : 'error',
            resultSummary: event.resultSummary,
            error: event.error,
            requiresApproval: event.requiresApproval,
            taskAssistantId: event.taskAssistantId,
            agentName: event.agentName,
          });
          didChange = true;
        }
      }

      if (!didChange || batchCalls.length === 0) {
        return prev;
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

  const clearAll = useCallback(() => {
    setToolCallBatches(new Map());
    setPendingAssistantMessage(null);
    setAgentMonologue(new Map());
    assistantTurnStartedRef.current = false;
  }, []);

  // Reset when session changes
  useEffect(() => {
    clearAll();
  }, [sessionId, clearAll]);

  return {
    toolCallBatches,
    pendingAssistantMessage,
    agentMonologue,
    clear: clearAll,
  };
}
