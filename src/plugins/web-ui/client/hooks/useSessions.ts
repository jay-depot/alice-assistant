import { useCallback, useEffect, useState } from 'react';
import { fetchSessions } from '../api/sessions.js';
import type { SessionSummary } from '../types/index.js';

export function useSessions(onError?: (message: string) => void) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await fetchSessions());
    } catch (error) {
      console.error('Failed to refresh sessions:', error);
      onError?.('Failed to load previous conversations.');
    }
  }, [onError]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  return {
    sessions,
    setSessions,
    refreshSessions,
  };
}
