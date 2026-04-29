import { useState, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { classNames } from '../utils.js';
import { ToolCallBatch } from './ToolCallBatch.js';
import type { StreamTurn } from '../hooks/useStreamingSession.js';
import type { ToolCallData } from '../types/index.js';

interface StreamTurnContainerProps {
  turn: StreamTurn;
  isCurrent: boolean;
  isComplete: boolean;
  toolCallBatch?: ToolCallData[];
  expandedKeys: Set<string>;
  onSetExpanded: (key: string, expanded: boolean) => void;
}

export function StreamTurnContainer({
  turn,
  isCurrent,
  isComplete,
  toolCallBatch,
  expandedKeys,
  onSetExpanded,
}: StreamTurnContainerProps) {
  const containerKey = `turn-${turn.turnIndex}`;
  const isExpanded = expandedKeys.has(containerKey);
  const [wasEverCurrent, setWasEverCurrent] = useState(false);

  // Auto-expand when this turn becomes the current one or is expanded by user
  useEffect(() => {
    if (isCurrent) {
      setWasEverCurrent(true);
      if (!isExpanded) {
        onSetExpanded(containerKey, true);
      }
    }
  }, [isCurrent, isExpanded, containerKey, onSetExpanded]);

  // Auto-collapse when complete and was previously the current turn
  useEffect(() => {
    if (isComplete && wasEverCurrent && isExpanded && !isCurrent) {
      onSetExpanded(containerKey, false);
    }
    // Only run when isComplete transitions
  }, [isComplete]);

  const hasContent =
    turn.reasoning.length > 0 ||
    turn.content.length > 0 ||
    (toolCallBatch && toolCallBatch.length > 0);

  if (!hasContent && !isCurrent) {
    return null;
  }

  return (
    <div
      className={classNames(
        'stream-turn',
        isExpanded ? 'stream-turn--expanded' : 'stream-turn--collapsed',
        isCurrent && 'stream-turn--current',
        isComplete && 'stream-turn--complete'
      )}
    >
      <button
        type="button"
        className="stream-turn__header"
        onClick={() => onSetExpanded(containerKey, !isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="stream-turn__toggle">{isExpanded ? '▾' : '▸'}</span>
        {isCurrent && !isComplete ? (
          <span className="stream-turn__spinner" aria-label="Processing" />
        ) : null}
        <span className="stream-turn__label">
          {isCurrent && !isComplete
            ? 'Thinking\u2026'
            : `Turn ${turn.turnIndex + 1}`}
        </span>
      </button>

      {isExpanded ? (
        <div className="stream-turn__body">
          {turn.reasoning ? (
            <div className="stream-turn__reasoning">
              <Markdown remarkPlugins={[remarkGfm]}>{turn.reasoning}</Markdown>
            </div>
          ) : null}

          {toolCallBatch && toolCallBatch.length > 0 ? (
            <ToolCallBatch calls={toolCallBatch} />
          ) : null}

          {turn.content ? (
            <div className="stream-turn__content">
              <Markdown remarkPlugins={[remarkGfm]}>{turn.content}</Markdown>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
