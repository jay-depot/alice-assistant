import { useEffect } from 'react';

interface ErrorToastProps {
  message: string | null;
  onClear: () => void;
}

export function ErrorToast({ message, onClear }: ErrorToastProps) {
  useEffect(() => {
    if (!message) {
      return;
    }

    const timeoutId = window.setTimeout(onClear, 4000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [message, onClear]);

  if (!message) {
    return null;
  }

  return <div className="error-toast">{message}</div>;
}
