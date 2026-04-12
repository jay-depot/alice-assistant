export function TypingIndicator() {
  return (
    <div
      className="message message--assistant"
      aria-live="polite"
      aria-label="Alice is typing"
    >
      <div className="message__bubble typing-indicator">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  );
}
