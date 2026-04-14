import { useState } from 'react';
import { classNames } from '../utils.js';
import { humanizeToolName } from '../utils/tool-call-batch.js';
import type { ToolCallData } from '../types/index.js';

interface ToolCallIndicatorProps {
  call: ToolCallData;
}

export function ToolCallIndicator({ call }: ToolCallIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusIcon =
    call.status === 'running' ? (
      <span className="tool-call-indicator__spinner" aria-label="Running" />
    ) : call.status === 'completed' ? (
      <span className="tool-call-indicator__check" aria-label="Completed">
        ✓
      </span>
    ) : (
      <span className="tool-call-indicator__error-icon" aria-label="Error">
        ✗
      </span>
    );

  return (
    <div
      className={classNames(
        'tool-call-indicator',
        `tool-call-indicator--${call.status}`
      )}
    >
      <div className="tool-call-indicator__header">
        {call.status !== 'running' ? (
          <button
            type="button"
            className="tool-call-indicator__toggle"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tool-call-indicator__toggle-spacer" />
        )}
        {statusIcon}
        <span className="tool-call-indicator__name">
          {humanizeToolName(call.toolName)}
        </span>
        {call.requiresApproval ? (
          <span
            className="tool-call-indicator__approval-badge"
            aria-label="Requires approval"
            title="Requires approval"
          >
            🔒
          </span>
        ) : null}
      </div>
      {isExpanded ? (
        <div className="tool-call-indicator__details">
          {call.status === 'completed' && call.resultSummary ? (
            <div className="tool-call-indicator__result">
              {call.resultSummary}
            </div>
          ) : null}
          {call.status === 'error' && call.error ? (
            <div className="tool-call-indicator__error">{call.error}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
