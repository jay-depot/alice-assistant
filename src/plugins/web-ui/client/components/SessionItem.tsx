import { formatRelativeTime } from '../utils.js';
import { classNames } from '../utils.js';
import type { SessionSummary } from '../types/index.js';

interface SessionItemProps {
  session: SessionSummary;
  isActive: boolean;
  onClick: (id: number | string) => void;
}

export function SessionItem({ session, isActive, onClick }: SessionItemProps) {
  const preview = session.lastAssistantMessage || session.lastUserMessage || 'No messages yet';

  return (
    <div
      className={classNames('session-item', isActive && 'session-item--active')}
      data-id={String(session.id)}
      onClick={() => onClick(session.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(session.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="session-item__title">{session.title}</div>
      <div className="session-item__preview">{preview}</div>
      <div className="session-item__time">{formatRelativeTime(session.lastMessageAt)}</div>
    </div>
  );
}
