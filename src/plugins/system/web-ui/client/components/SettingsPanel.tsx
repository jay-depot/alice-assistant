import { NavLink } from 'react-router-dom';
import { RegionSlot } from './RegionSlot.js';
import { classNames } from '../utils.js';
import type { PluginClientRoute } from '../types/index.js';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  routes: PluginClientRoute[];
}

function pluginRouteLabel(route: PluginClientRoute): string {
  return route.title?.trim() || route.path.replace(/^\//, '') || 'Plugin page';
}

export function SettingsPanel({ isOpen, onClose, routes }: SettingsPanelProps) {
  return (
    <aside
      className={classNames('settings-panel', isOpen && 'settings-panel--open')}
    >
      <div className="settings-panel__header">
        <h2>Interface Settings</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          title="Close settings panel"
        >
          ✕
        </button>
      </div>

      <div className="settings-panel__body">
        <RegionSlot region="settings-panel" />
        {routes.length > 0 ? (
          <nav
            className="settings-panel__nav plugin-nav"
            aria-label="Plugin pages"
          >
            {routes.map(route => (
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
                {pluginRouteLabel(route)}
              </NavLink>
            ))}
          </nav>
        ) : null}
        <p className="settings-panel__placeholder">
          Plugin-provided controls and interface settings will appear here.
        </p>
      </div>
    </aside>
  );
}
