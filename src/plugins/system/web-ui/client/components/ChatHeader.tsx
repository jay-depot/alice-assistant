import { RegionSlot } from './RegionSlot.js';

interface ChatHeaderProps {
  title: string;
  showDelete: boolean;
  canDelete: boolean;
  isEndingSession: boolean;
  onDelete: () => void;
  onOpenSettings: () => void;
  onBack?: () => void;
  backLabel?: string;
}

export function ChatHeader({
  title,
  showDelete,
  canDelete,
  isEndingSession,
  onDelete,
  onOpenSettings,
  onBack,
  backLabel = 'Back to Chat',
}: ChatHeaderProps) {
  return (
    <header id="chat-header">
      <div className="chat-header__left">
        {onBack ? (
          <button
            type="button"
            className="chat-header__back"
            title={backLabel}
            onClick={onBack}
          >
            <span aria-hidden="true">&larr;</span>
            <span>{backLabel}</span>
          </button>
        ) : null}
        <span id="session-title">{title}</span>
      </div>

      <div className="chat-header__actions">
        <RegionSlot region="chat-header" />
        {showDelete ? (
          <button
            id="delete-session-btn"
            type="button"
            disabled={!canDelete}
            title={
              isEndingSession
                ? 'Archiving this session'
                : 'End and archive this session'
            }
            onClick={onDelete}
          >
            {isEndingSession ? (
              <>
                <span
                  className="header-action-spinner"
                  aria-hidden="true"
                ></span>
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
