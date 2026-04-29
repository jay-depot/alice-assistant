import { useState, useEffect } from 'react';

interface ThinkingBlockProps {
  content: string | null;
  isThinking: boolean;
}

export function ThinkingBlock({ content, isThinking }: ThinkingBlockProps) {
  const [showExpanded, setShowExpanded] = useState(isThinking);

  useEffect(() => {
    if (isThinking && !showExpanded) {
      setShowExpanded(true);
    }
  }, [isThinking, showExpanded]);

  if (!content || content.length === 0) {
    return null;
  }

  return (
    <div
      className={
        'thinking-block' +
        (showExpanded
          ? ' thinking-block--expanded'
          : ' thinking-block--collapsed')
      }
    >
      <button
        type="button"
        className="thinking-block__toggle"
        onClick={() => setShowExpanded(prev => !prev)}
        aria-label={showExpanded ? 'Collapse reasoning' : 'Expand reasoning'}
      >
        {isThinking ? 'Alice is reasoning...' : 'Reasoning'}
      </button>
      <div className="thinking-block__content">
        <pre>{content}</pre>
      </div>
    </div>
  );
}
