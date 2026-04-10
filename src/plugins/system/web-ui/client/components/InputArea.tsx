import { useEffect, useRef } from 'react';
import { RegionSlot } from './RegionSlot.js';

interface InputAreaProps {
  value: string;
  onChange: (nextValue: string) => void;
  onSubmit: () => void;
  inputDisabled: boolean;
  submitDisabled: boolean;
  placeholder: string;
}

export function InputArea({
  value,
  onChange,
  onSubmit,
  inputDisabled,
  submitDisabled,
  placeholder,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, [value]);

  return (
    <div className="input-shell">
      <RegionSlot region="input-prefix" />
      <footer id="input-area">
        <textarea
          ref={textareaRef}
          id="message-input"
          placeholder={placeholder}
          rows={1}
          disabled={inputDisabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!submitDisabled) {
                onSubmit();
              }
            }
          }}
        ></textarea>
        <button id="send-btn" disabled={submitDisabled} title="Send message (Enter)" onClick={onSubmit}>
          &#9650;
        </button>
      </footer>
    </div>
  );
}
