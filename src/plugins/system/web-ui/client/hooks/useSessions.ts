import { useCallback, useEffect, useState } from 'react';
import { fetchSessions } from '../api/sessions.js';
import type { SessionSummary } from '../types/index.js';
import { useWebSocket } from './useWebSocket.js';

export function useSessions(onError?: (message: string) => void) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const { subscribe } = useWebSocket();

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await fetchSessions());
    } catch (error) {
      console.error('Failed to refresh sessions:', error);
      onError?.('Failed to load previous conversations.');
    }
  }, [onError]);

  // Initial load on mount
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Real-time updates pushed by the server; replaces the previous 10 s poll
  useEffect(() => {
    return subscribe(msg => {
      if (msg.type !== 'sessions_list_updated') {
        return;
      }
      setSessions(msg.sessions as SessionSummary[]);
    });
  }, [subscribe, setSessions]);

  return {
    sessions,
    setSessions,
    refreshSessions,
  };
}
