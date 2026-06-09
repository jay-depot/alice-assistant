import { useEffect, useRef } from 'react';
import { RegionSlot } from './RegionSlot.js';
import type { ImageAttachment } from '../types/index.js';

interface InputAreaProps {
  value: string;
  onChange: (nextValue: string) => void;
  onSubmit: () => void;
  attachments: ImageAttachment[];
  onSelectFiles: (files: FileList | null) => void;
  onClearAttachments: () => void;
  inputDisabled: boolean;
  submitDisabled: boolean;
  placeholder: string;
}

export function InputArea({
  value,
  onChange,
  onSubmit,
  attachments,
  onSelectFiles,
  onClearAttachments,
  inputDisabled,
  submitDisabled,
  placeholder,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={event => {
            onSelectFiles(event.target.files);
            event.currentTarget.value = '';
          }}
        />
        <textarea
          ref={textareaRef}
          id="message-input"
          placeholder={placeholder}
          rows={1}
          disabled={inputDisabled}
          value={value}
          onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!submitDisabled) {
                onSubmit();
              }
            }
          }}
        ></textarea>
        <button
          type="button"
          className="input-area__aux-btn"
          disabled={inputDisabled}
          title="Attach image"
          onClick={() => fileInputRef.current?.click()}
        >
          Attach
        </button>
        {attachments.length > 0 ? (
          <button
            type="button"
            className="input-area__aux-btn"
            disabled={inputDisabled}
            title="Clear attachments"
            onClick={onClearAttachments}
          >
            Clear ({attachments.length})
          </button>
        ) : null}
        <button
          id="send-btn"
          disabled={submitDisabled}
          title="Send message (Enter)"
          onClick={onSubmit}
        >
          Send
        </button>
      </footer>
    </div>
  );
}
