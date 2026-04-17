/**
 * Tool call batch grouping and formatting utilities.
 *
 * Shared between the blessed and readline frontends for consistent
 * tool call display.
 */

import type { WsToolCallEvent, TuiToolCallBatch } from './tui-types.js';

/**
 * Update the batch map with a new tool call event.
 * Creates or updates batch entries as events arrive.
 */
export function groupToolCallBatches(
  batches: Map<string, TuiToolCallBatch>,
  event: WsToolCallEvent
): void {
  if (!event.callBatchId) {
    return;
  }

  const batchId = event.callBatchId;

  if (!batches.has(batchId)) {
    batches.set(batchId, {
      callBatchId: batchId,
      calls: [],
      status: 'running',
      agentName: event.agentName,
    });
  }

  const batch = batches.get(batchId)!;

  if (event.agentName) {
    batch.agentName = event.agentName;
  }

  switch (event.type) {
    case 'tool_call_started':
      batch.calls.push({
        toolName: event.toolName ?? 'unknown',
        status: 'running',
      });
      batch.status = 'running';
      break;

    case 'tool_call_completed': {
      const entry = batch.calls.find(
        c => c.toolName === event.toolName && c.status === 'running'
      );
      if (entry) {
        entry.status = 'completed';
        entry.resultSummary = event.resultSummary;
      } else {
        batch.calls.push({
          toolName: event.toolName ?? 'unknown',
          status: 'completed',
          resultSummary: event.resultSummary,
        });
      }
      break;
    }

    case 'tool_call_error': {
      const errEntry = batch.calls.find(
        c => c.toolName === event.toolName && c.status === 'running'
      );
      if (errEntry) {
        errEntry.status = 'error';
        errEntry.error = event.error;
      } else {
        batch.calls.push({
          toolName: event.toolName ?? 'unknown',
          status: 'error',
          error: event.error,
        });
      }
      break;
    }
  }

  // Update batch-level status
  if (batch.calls.some(c => c.status === 'running')) {
    batch.status = 'running';
  } else if (batch.calls.some(c => c.status === 'error')) {
    batch.status = 'error';
  } else {
    batch.status = 'completed';
  }
}

/**
 * Format a tool call batch as a single-line summary.
 *
 * Running:  ⚙ Using weather, search…
 * Done:     ✓ Used weather, search
 * Error:    ✗ Used weather, search — failed
 */
export function formatToolCallBatchLine(batch: TuiToolCallBatch): string {
  const toolNames = batch.calls.map(c => humanizeToolName(c.toolName));
  const names = toolNames.join(', ');

  switch (batch.status) {
    case 'running':
      return `⚙ Using ${names}…`;
    case 'completed':
      return `✓ Used ${names}`;
    case 'error':
      return `✗ Used ${names} — failed`;
  }
}

/**
 * Convert a kebab-case tool name to title case for display.
 * e.g. "web-search" → "Web Search"
 */
export function humanizeToolName(name: string): string {
  return name
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
