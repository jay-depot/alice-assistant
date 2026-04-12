interface ProcessingStatusProps {
  label?: string;
}

export function ProcessingStatus({
  label = 'Alice is thinking',
}: ProcessingStatusProps) {
  return (
    <div className="processing-status" aria-live="polite" aria-label={label}>
      <span className="processing-status__dot" aria-hidden="true"></span>
      <span className="processing-status__text">{label}</span>
    </div>
  );
}
