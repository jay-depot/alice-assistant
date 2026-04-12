import { SessionItem } from './SessionItem.js';
import type { SessionSummary } from '../types/index.js';

interface SessionsListProps {
  sessions: SessionSummary[];
  currentSessionId: number | string | null;
  onSelectSession: (id: number | string) => void;
}

export function SessionsList({
  sessions,
  currentSessionId,
  onSelectSession,
}: SessionsListProps) {
  return (
    <div id="sessions-list">
      {sessions.length === 0 ? (
        <div className="sessions-empty">No previous sessions</div>
      ) : (
        sessions.map(session => (
          <SessionItem
            key={String(session.id)}
            session={session}
            isActive={String(session.id) === String(currentSessionId)}
            onClick={onSelectSession}
          />
        ))
      )}
    </div>
  );
}
