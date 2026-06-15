import { useAssistantInfo } from '../context/AssistantInfoContext.js';

export function TypingIndicator() {
  const { displayName } = useAssistantInfo();

  return (
    <div
      className="message message--assistant"
      aria-live="polite"
      aria-label={`${displayName} is typing`}
    >
      <div className="message__bubble typing-indicator">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  );
}
