import { describe, it, expect } from 'vitest';
import {
  getBatchStatus,
  getBatchHeaderLabel,
  humanizeToolName,
} from './tool-call-batch.js';
import type { ToolCallData } from '../types/index.js';

describe('humanizeToolName', () => {
  it('converts kebab-case to title case', () => {
    expect(humanizeToolName('web-search')).toBe('Web Search');
  });

  it('converts snake_case to title case', () => {
    expect(humanizeToolName('system_health')).toBe('System Health');
  });

  it('handles single-word names', () => {
    expect(humanizeToolName('weather')).toBe('Weather');
  });

  it('handles mixed separators', () => {
    expect(humanizeToolName('web_search-broker')).toBe('Web Search Broker');
  });
});

describe('getBatchStatus', () => {
  it('returns running if any call is running', () => {
    const calls: ToolCallData[] = [
      { callBatchId: '1', toolName: 'weather', status: 'running' },
      { callBatchId: '1', toolName: 'systemHealth', status: 'completed' },
    ];
    expect(getBatchStatus(calls)).toBe('running');
  });

  it('returns error if no call is running and at least one is error', () => {
    const calls: ToolCallData[] = [
      { callBatchId: '1', toolName: 'weather', status: 'completed' },
      {
        callBatchId: '1',
        toolName: 'webSearch',
        status: 'error',
        error: 'timeout',
      },
    ];
    expect(getBatchStatus(calls)).toBe('error');
  });

  it('returns completed if all calls are completed', () => {
    const calls: ToolCallData[] = [
      {
        callBatchId: '1',
        toolName: 'weather',
        status: 'completed',
        resultSummary: 'Sunny',
      },
      {
        callBatchId: '1',
        toolName: 'systemHealth',
        status: 'completed',
        resultSummary: 'OK',
      },
    ];
    expect(getBatchStatus(calls)).toBe('completed');
  });

  it('returns completed for a single completed call', () => {
    const calls: ToolCallData[] = [
      {
        callBatchId: '1',
        toolName: 'weather',
        status: 'completed',
        resultSummary: 'Rain',
      },
    ];
    expect(getBatchStatus(calls)).toBe('completed');
  });

  it('returns error when all calls are errors', () => {
    const calls: ToolCallData[] = [
      { callBatchId: '1', toolName: 'weather', status: 'error', error: 'fail' },
      {
        callBatchId: '1',
        toolName: 'webSearch',
        status: 'error',
        error: 'timeout',
      },
    ];
    expect(getBatchStatus(calls)).toBe('error');
  });
});

describe('getBatchHeaderLabel', () => {
  it('shows "Using weather…" for a single running tool', () => {
    const calls: ToolCallData[] = [
      { callBatchId: '1', toolName: 'weather', status: 'running' },
    ];
    expect(getBatchHeaderLabel(calls, 'running')).toBe('Using Weather…');
  });

  it('shows "Using 3 tools…" for multiple running tools', () => {
    const calls: ToolCallData[] = [
      { callBatchId: '1', toolName: 'weather', status: 'running' },
      { callBatchId: '1', toolName: 'systemHealth', status: 'running' },
      { callBatchId: '1', toolName: 'webSearch', status: 'running' },
    ];
    expect(getBatchHeaderLabel(calls, 'running')).toBe('Using 3 tools…');
  });

  it('shows "Used weather" for a single completed tool', () => {
    const calls: ToolCallData[] = [
      { callBatchId: '1', toolName: 'weather', status: 'completed' },
    ];
    expect(getBatchHeaderLabel(calls, 'completed')).toBe('Used Weather');
  });

  it('shows "Used 2 tools" for multiple completed tools', () => {
    const calls: ToolCallData[] = [
      { callBatchId: '1', toolName: 'weather', status: 'completed' },
      { callBatchId: '1', toolName: 'systemHealth', status: 'completed' },
    ];
    expect(getBatchHeaderLabel(calls, 'completed')).toBe('Used 2 tools');
  });

  it('shows "Used weather — failed" for a single error tool', () => {
    const calls: ToolCallData[] = [
      { callBatchId: '1', toolName: 'weather', status: 'error', error: 'fail' },
    ];
    expect(getBatchHeaderLabel(calls, 'error')).toBe('Used Weather — failed');
  });

  it('shows "Used 3 tools — 1 failed" for mixed completed/error', () => {
    const calls: ToolCallData[] = [
      { callBatchId: '1', toolName: 'weather', status: 'completed' },
      { callBatchId: '1', toolName: 'systemHealth', status: 'completed' },
      {
        callBatchId: '1',
        toolName: 'webSearch',
        status: 'error',
        error: 'timeout',
      },
    ];
    expect(getBatchHeaderLabel(calls, 'error')).toBe('Used 3 tools — 1 failed');
  });

  it('shows "Used 2 tools — 2 failed" when all are errors', () => {
    const calls: ToolCallData[] = [
      { callBatchId: '1', toolName: 'weather', status: 'error', error: 'fail' },
      {
        callBatchId: '1',
        toolName: 'webSearch',
        status: 'error',
        error: 'timeout',
      },
    ];
    expect(getBatchHeaderLabel(calls, 'error')).toBe('Used 2 tools — 2 failed');
  });
});
