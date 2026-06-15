import { useAssistantInfo } from '../context/AssistantInfoContext.js';

export function WelcomeScreen() {
  const { displayName } = useAssistantInfo();

  return (
    <div id="welcome-screen">
      <div className="welcome-content">
        <div className="welcome-logo">{displayName}</div>
        <p className="welcome-hint">
          Click <strong>+ New Chat</strong> to begin, or select a previous
          session.
        </p>
      </div>
    </div>
  );
}
