import { RegionSlot } from './RegionSlot.js';

interface ChatHeaderProps {
  title: string;
  canDelete: boolean;
  onDelete: () => void;
  onOpenSettings: () => void;
}

export function ChatHeader({ title, canDelete, onDelete, onOpenSettings }: ChatHeaderProps) {
  return (
    <header id="chat-header">
      <div className="chat-header__left">
        <span id="session-title">{title}</span>
      </div>

      <div className="chat-header__actions">
        <RegionSlot region="chat-header" />
        <button
          type="button"
          className="icon-btn"
          title="Open interface settings"
          onClick={onOpenSettings}
        >
          ⚙
        </button>
        <button
          id="delete-session-btn"
          className={canDelete ? '' : 'hidden'}
          title="End and archive this session"
          onClick={onDelete}
        >
          End Session
        </button>
      </div>
    </header>
  );
}
