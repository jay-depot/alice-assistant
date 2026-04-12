interface ReadReceiptIconProps {
  variant: 'sent' | 'read';
}

export function ReadReceiptIcon({ variant }: ReadReceiptIconProps) {
  return (
    <svg
      className="message__status-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1.5 8.4 4.6 11.5 9.4 5.7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      {variant === 'read' ? (
        <path
          d="M6.6 8.4 9.7 11.5 14.5 5.7"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      ) : null}
    </svg>
  );
}
