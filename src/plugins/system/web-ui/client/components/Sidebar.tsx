import { RegionSlot } from './RegionSlot.js';
import { SessionsList } from './SessionsList.js';
import { useAssistantInfo } from '../context/AssistantInfoContext.js';
import type { SessionSummary } from '../types/index.js';

interface SidebarProps {
  sessions: SessionSummary[];
  currentSessionId: number | string | null;
  onSelectSession: (id: number | string) => void;
  onNewChat: () => void;
}

export function Sidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
}: SidebarProps) {
  const { displayName } = useAssistantInfo();

  return (
    <aside id="sidebar">
      <div id="sidebar-header">
        <RegionSlot region="sidebar-top" />
        <div className="logo">{displayName}</div>
        <button
          id="new-chat-btn"
          title="Start a new conversation"
          onClick={onNewChat}
        >
          + New Chat
        </button>
      </div>
      <SessionsList
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={onSelectSession}
      />

      <RegionSlot region="sidebar-bottom" />
    </aside>
  );
}
