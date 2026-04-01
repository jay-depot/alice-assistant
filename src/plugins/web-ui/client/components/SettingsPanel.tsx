import { RegionSlot } from './RegionSlot.js';
import { classNames } from '../utils.js';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  return (
    <aside className={classNames('settings-panel', isOpen && 'settings-panel--open')}>
      <div className="settings-panel__header">
        <h2>Interface Settings</h2>
        <button type="button" className="icon-btn" onClick={onClose} title="Close settings panel">
          ✕
        </button>
      </div>

      <div className="settings-panel__body">
        <RegionSlot region="settings-panel" />
        <p className="settings-panel__placeholder">
          Plugin-provided controls and interface settings will appear here.
        </p>
      </div>
    </aside>
  );
}
