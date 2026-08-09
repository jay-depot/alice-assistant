import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from './useWebSocket.js';

/** One LLM turn within a multi-turn streaming cycle.
 *  Each turn accumulates reasoning and content deltas until the server
 *  emits stream_turn_complete (tool calls triggered) or stream_done (finished). */
export interface StreamTurn {
  turnIndex: number;
  reasoning: string;
  content: string;
  isComplete: boolean;
  /** callBatchId from stream_turn_complete — links this turn to the tool
   *  call batch that follows.  Null when this turn did not trigger tools. */
  callBatchId: string | null;
}

export interface StreamingState {
  /** Completed turns (stream_turn_complete has fired for each). */
  turns: StreamTurn[];
  /** The turn currently receiving deltas, or null when not streaming. */
  currentTurn: StreamTurn | null;
  /** Final assistant content from the most recent stream_done. Persists across
   *  the handoff window until the persisted message arrives via session_updated. */
  finalContent: string;
  /** Final assistant reasoning from the most recent stream_done. */
  finalReasoning: string | null;
  isStreaming: boolean;
  reset: () => void;
}

export function useStreamingSession(
  currentSessionId: number | string | null
): StreamingState {
  const [turns, setTurns] = useState<StreamTurn[]>([]);
  const [currentTurn, setCurrentTurn] = useState<StreamTurn | null>(null);
  const [finalContent, setFinalContent] = useState('');
  const [finalReasoning, setFinalReasoning] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  /** Tracks the next turnIndex to assign. Incremented on stream_turn_complete. */
  const nextTurnIndexRef = useRef(0);
  /** Mirrors currentTurn so handlers can read the latest turn outside a
   *  setState updater (updaters must stay pure — no nested setState). */
  const currentTurnRef = useRef<StreamTurn | null>(null);

  const { subscribe } = useWebSocket();

  const updateCurrentTurn = useCallback(
    (updater: (prev: StreamTurn | null) => StreamTurn | null) => {
      setCurrentTurn(prev => {
        const next = updater(prev);
        currentTurnRef.current = next;
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (currentSessionId === null) {
      setTurns([]);
      setCurrentTurn(null);
      currentTurnRef.current = null;
      setFinalContent('');
      setFinalReasoning(null);
      setIsStreaming(false);
      nextTurnIndexRef.current = 0;
      return;
    }

    const numericId =
      typeof currentSessionId === 'string'
        ? parseInt(currentSessionId)
        : currentSessionId;

    // Reset accumulated state when the session changes.
    setTurns([]);
    setCurrentTurn(null);
    currentTurnRef.current = null;
    setFinalContent('');
    setFinalReasoning(null);
    setIsStreaming(false);
    nextTurnIndexRef.current = 0;

    return subscribe(msg => {
      if (!('sessionId' in msg) || msg.sessionId !== numericId) {
        return;
      }

      if (msg.type === 'stream_thinking') {
        setIsStreaming(true);
        updateCurrentTurn(prev => {
          const turn =
            prev ??
            ((): StreamTurn => ({
              turnIndex: nextTurnIndexRef.current,
              reasoning: '',
              content: '',
              isComplete: false,
              callBatchId: null,
            }))();
          return { ...turn, reasoning: turn.reasoning + msg.delta };
        });
      } else if (msg.type === 'stream_content') {
        setIsStreaming(true);
        updateCurrentTurn(prev => {
          const turn =
            prev ??
            ((): StreamTurn => ({
              turnIndex: nextTurnIndexRef.current,
              reasoning: '',
              content: '',
              isComplete: false,
              callBatchId: null,
            }))();
          return { ...turn, content: turn.content + msg.delta };
        });
      } else if (msg.type === 'stream_tool_calls') {
        setIsStreaming(true);
      } else if (msg.type === 'stream_turn_complete') {
        // Finalize the current turn, stamping its callBatchId so the
        // UI can interleave the tool-call batch between turns.
        const prev = currentTurnRef.current;
        if (prev) {
          const completedTurn = {
            ...prev,
            isComplete: true,
            callBatchId: msg.callBatchId,
          };
          setTurns(prevTurns => [...prevTurns, completedTurn]);
          nextTurnIndexRef.current += 1;
          const nextIndex = nextTurnIndexRef.current;
          updateCurrentTurn(() => ({
            turnIndex: nextIndex,
            reasoning: '',
            content: '',
            isComplete: false,
            callBatchId: null,
          }));
        }
      } else if (msg.type === 'stream_done') {
        // Finalize the current turn if it has content, then hold the
        // finalContent / finalReasoning for the handoff bubble.
        const prev = currentTurnRef.current;
        if (prev && (prev.reasoning.length > 0 || prev.content.length > 0)) {
          const completedTurn = { ...prev, isComplete: true };
          setTurns(prevTurns => [...prevTurns, completedTurn]);
        }
        updateCurrentTurn(() => null);
        setFinalContent(msg.finalContent);
        setFinalReasoning(msg.finalReasoning);
        setIsStreaming(false);
      } else if (msg.type === 'stream_error') {
        const prev = currentTurnRef.current;
        if (prev && (prev.reasoning.length > 0 || prev.content.length > 0)) {
          const completedTurn = { ...prev, isComplete: true };
          setTurns(prevTurns => [...prevTurns, completedTurn]);
        }
        updateCurrentTurn(() => null);
        setFinalContent('');
        setFinalReasoning(null);
        setIsStreaming(false);
      }
    });
  }, [currentSessionId, subscribe, updateCurrentTurn]);

  const reset = useCallback(() => {
    setTurns([]);
    setCurrentTurn(null);
    currentTurnRef.current = null;
    setFinalContent('');
    setFinalReasoning(null);
    setIsStreaming(false);
    nextTurnIndexRef.current = 0;
  }, []);

  return {
    turns,
    currentTurn,
    finalContent,
    finalReasoning,
    isStreaming,
    reset,
  };
}
