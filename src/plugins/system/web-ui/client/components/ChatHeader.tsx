import { RegionSlot } from './RegionSlot.js';

interface ChatHeaderProps {
  title: string;
  showDelete: boolean;
  canDelete: boolean;
  isEndingSession: boolean;
  onDelete: () => void;
  onOpenSettings: () => void;
}

export function ChatHeader({
  title,
  showDelete,
  canDelete,
  isEndingSession,
  onDelete,
  onOpenSettings,
}: ChatHeaderProps) {
  return (
    <header id="chat-header">
      <div className="chat-header__left">
        <span id="session-title">{title}</span>
      </div>

      <div className="chat-header__actions">
        <RegionSlot region="chat-header" />
        {showDelete ? (
          <button
            id="delete-session-btn"
            type="button"
            disabled={!canDelete}
            title={isEndingSession ? 'Archiving this session' : 'End and archive this session'}
            onClick={onDelete}
          >
            {isEndingSession ? (
              <>
                <span className="header-action-spinner" aria-hidden="true"></span>
                <span>Archiving...</span>
              </>
            ) : (
              'End Session'
            )}
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn"
          title="Open interface settings"
          onClick={onOpenSettings}
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
