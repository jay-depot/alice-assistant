import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ToolCallEvents', () => {
  let ToolCallEvents: typeof import('./tool-system.js').ToolCallEvents;

  beforeEach(async () => {
    // Re-import to get a fresh module with a clean callback array.
    // Since the module caches callbacks in a module-level array, we
    // need to isolate by re-importing. However, ESM module caching
    // means we get the same module. We'll test the dispatch/subscribe
    // pattern directly instead.
    ({ ToolCallEvents } = await import('./tool-system.js'));
  });

  it('dispatches events to registered callbacks', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    ToolCallEvents.onToolCallEvent(callback);

    const event = {
      type: 'tool_call_started' as const,
      callBatchId: 'test-batch-1',
      toolName: 'weather',
      toolArgs: { location: 'Portland' },
      conversationType: 'chat',
      timestamp: new Date().toISOString(),
    };

    await ToolCallEvents.dispatchToolCallEvent(event);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(event);
  });

  it('dispatches events to multiple callbacks', async () => {
    const callback1 = vi.fn().mockResolvedValue(undefined);
    const callback2 = vi.fn().mockResolvedValue(undefined);
    ToolCallEvents.onToolCallEvent(callback1);
    ToolCallEvents.onToolCallEvent(callback2);

    const event = {
      type: 'tool_call_completed' as const,
      callBatchId: 'test-batch-2',
      toolName: 'systemHealth',
      toolArgs: {},
      conversationType: 'chat',
      resultSummary: 'All systems nominal',
      timestamp: new Date().toISOString(),
    };

    await ToolCallEvents.dispatchToolCallEvent(event);

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledTimes(1);
  });

  it('dispatches tool_call_error events', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    ToolCallEvents.onToolCallEvent(callback);

    const event = {
      type: 'tool_call_error' as const,
      callBatchId: 'test-batch-3',
      toolName: 'webSearch',
      toolArgs: { query: 'test' },
      conversationType: 'chat',
      error: 'Network timeout',
      timestamp: new Date().toISOString(),
    };

    await ToolCallEvents.dispatchToolCallEvent(event);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_call_error',
        error: 'Network timeout',
      })
    );
  });
});
