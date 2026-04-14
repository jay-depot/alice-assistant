import { useState, useEffect } from 'react';
import { classNames, normalizeCssToken } from '../utils.js';
import {
  getBatchStatus,
  getBatchHeaderLabel,
} from '../utils/tool-call-batch.js';
import { ToolCallIndicator } from './ToolCallIndicator.js';
import type { ToolCallData } from '../types/index.js';

interface ToolCallBatchProps {
  calls: ToolCallData[];
}

export function ToolCallBatch({ calls }: ToolCallBatchProps) {
  const status = getBatchStatus(calls);
  const headerLabel = getBatchHeaderLabel(calls, status);
  const [isExpanded, setIsExpanded] = useState(status === 'running');

  // All calls in a batch share the same taskAssistantId / agentName (or none)
  const taskAssistantId = calls[0]?.taskAssistantId;
  const agentName = calls[0]?.agentName;

  // Auto-collapse when the batch finishes
  useEffect(() => {
    if (status !== 'running') {
      setIsExpanded(false);
    }
  }, [status]);

  const statusIcon =
    status === 'running' ? (
      <span className="tool-call-batch__spinner" aria-label="Running" />
    ) : status === 'completed' ? (
      <span className="tool-call-batch__check" aria-label="Completed">
        ✓
      </span>
    ) : (
      <span className="tool-call-batch__warning" aria-label="Error">
        ⚠
      </span>
    );

  return (
    <div
      className={classNames(
        'tool-call-batch',
        `tool-call-batch--${status}`,
        isExpanded ? 'tool-call-batch--expanded' : 'tool-call-batch--collapsed',
        taskAssistantId
          ? `task-assistant--${normalizeCssToken(taskAssistantId)}`
          : null,
        agentName ? `agent--${normalizeCssToken(agentName)}` : null
      )}
    >
      <button
        type="button"
        className="tool-call-batch__header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="tool-call-batch__toggle">
          {isExpanded ? '▾' : '▸'}
        </span>
        {statusIcon}
        <span className="tool-call-batch__label">{headerLabel}</span>
      </button>
      {isExpanded ? (
        <div className="tool-call-batch__calls">
          {calls.map(call => (
            <ToolCallIndicator key={call.toolName} call={call} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
