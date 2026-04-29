import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from './useWebSocket.js';

export interface StreamingState {
  streamingContent: string;
  streamingThinking: string | null;
  isThinking: boolean;
  isStreaming: boolean;
  reset: () => void;
}

export function useStreamingSession(
  currentSessionId: number | string | null
): StreamingState {
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState<string | null>(
    null
  );
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  const { subscribe } = useWebSocket();

  useEffect(() => {
    if (currentSessionId === null) {
      setStreamingContent('');
      setStreamingThinking(null);
      setIsThinking(false);
      setIsStreaming(false);
      return;
    }

    const numericId =
      typeof currentSessionId === 'string'
        ? parseInt(currentSessionId)
        : currentSessionId;

    return subscribe(msg => {
      if (!('sessionId' in msg) || msg.sessionId !== numericId) {
        return;
      }

      if (msg.type === 'stream_thinking') {
        setIsStreaming(true);
        setIsThinking(true);
        setStreamingThinking(prev => (prev ?? '') + msg.delta);
      } else if (msg.type === 'stream_content') {
        setIsStreaming(true);
        setIsThinking(false);
        setStreamingContent(prev => prev + msg.delta);
      } else if (msg.type === 'stream_tool_calls') {
        setIsStreaming(true);
        setIsThinking(false);
      } else if (msg.type === 'stream_done') {
        setIsStreaming(false);
        setIsThinking(false);
        setStreamingContent('');
        setStreamingThinking(null);
      } else if (msg.type === 'stream_error') {
        setIsStreaming(false);
        setIsThinking(false);
        setStreamingContent('');
        setStreamingThinking(null);
      }
    });
  }, [currentSessionId, subscribe]);

  const reset = useCallback(() => {
    setStreamingContent('');
    setStreamingThinking(null);
    setIsThinking(false);
    setIsStreaming(false);
  }, []);

  return {
    streamingContent,
    streamingThinking,
    isThinking,
    isStreaming,
    reset,
  };
}
