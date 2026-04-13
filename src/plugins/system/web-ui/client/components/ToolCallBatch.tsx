import { classNames } from '../utils.js';
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
      className={classNames('tool-call-batch', `tool-call-batch--${status}`)}
    >
      <div className="tool-call-batch__header">
        {statusIcon}
        <span className="tool-call-batch__label">{headerLabel}</span>
      </div>
      <div className="tool-call-batch__calls">
        {calls.map(call => (
          <ToolCallIndicator key={call.toolName} call={call} />
        ))}
      </div>
    </div>
  );
}
