import { useAssistantInfo } from '../context/AssistantInfoContext.js';

interface ProcessingStatusProps {
  label?: string;
}

export function ProcessingStatus({ label }: ProcessingStatusProps) {
  const { displayName } = useAssistantInfo();
  const resolvedLabel = label ?? `${displayName} is thinking`;

  return (
    <div
      className="processing-status"
      aria-live="polite"
      aria-label={resolvedLabel}
    >
      <span className="processing-status__dot" aria-hidden="true"></span>
      <span className="processing-status__text">{resolvedLabel}</span>
    </div>
  );
}
