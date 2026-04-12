import { NavLink } from 'react-router-dom';
import { RegionSlot } from './RegionSlot.js';
import { SessionsList } from './SessionsList.js';
import type { PluginClientRoute, SessionSummary } from '../types/index.js';
import { classNames } from '../utils.js';

interface SidebarProps {
  sessions: SessionSummary[];
  routes: PluginClientRoute[];
  currentSessionId: number | string | null;
  onSelectSession: (id: number | string) => void;
  onNewChat: () => void;
}

export function Sidebar({
  sessions,
  routes,
  currentSessionId,
  onSelectSession,
  onNewChat,
}: SidebarProps) {
  return (
    <aside id="sidebar">
      <div id="sidebar-header">
        <RegionSlot region="sidebar-top" />
        <div className="logo">A.L.I.C.E.</div>
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

      {routes.length > 0 ? (
        <nav className="plugin-nav" aria-label="Plugin pages">
          <div className="plugin-nav__title">Pages</div>
          {routes.map(route => {
            const label =
              route.title?.trim() ||
              route.path.replace(/^\//, '') ||
              'Plugin page';

            return (
              <NavLink
                key={route.path}
                to={route.path}
                className={({ isActive }) =>
                  classNames(
                    'plugin-nav__link',
                    isActive && 'plugin-nav__link--active'
                  )
                }
              >
                {label}
              </NavLink>
            );
          })}
        </nav>
      ) : null}

      <RegionSlot region="sidebar-bottom" />
    </aside>
  );
}
