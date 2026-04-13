import type { ToolCallData } from '../types/index.js';

export type BatchStatus = 'running' | 'completed' | 'error';

export function getBatchStatus(calls: ToolCallData[]): BatchStatus {
  if (calls.some(call => call.status === 'running')) return 'running';
  if (calls.some(call => call.status === 'error')) return 'error';
  return 'completed';
}

export function getBatchHeaderLabel(
  calls: ToolCallData[],
  status: BatchStatus
): string {
  const count = calls.length;
  const isSingle = count === 1;
  const name = isSingle
    ? humanizeToolName(calls[0].toolName)
    : `${count} tools`;

  if (status === 'running') return `Using ${name}…`;
  if (status === 'error') {
    const errorCount = calls.filter(c => c.status === 'error').length;
    return isSingle
      ? `Used ${name} — failed`
      : `Used ${name} — ${errorCount} failed`;
  }
  return `Used ${name}`;
}

export function humanizeToolName(toolName: string): string {
  return toolName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
