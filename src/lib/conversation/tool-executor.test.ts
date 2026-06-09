import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolCall } from 'ollama';

// Shared registry so addTool and getTools see the same tools.
const toolRegistry: Array<{
  name: string;
  availableFor: string[];
  description: string;
  systemPromptFragment: string;
  parameters: Record<string, unknown>;
  taintStatus?: string;
  requiresApproval?: boolean;
  execute: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('../tools.js', () => ({
  getTools: vi.fn(() => toolRegistry),
  addTool: vi.fn((tool: (typeof toolRegistry)[number]) =>
    toolRegistry.push(tool)
  ),
  hasTool: vi.fn((name: string) => toolRegistry.some(t => t.name === name)),
}));

vi.mock('../tool-system.js', () => ({
  buildOllamaToolDescriptionObject: vi.fn().mockReturnValue([]),
  ToolCallEvents: {
    dispatchToolCallEvent: vi.fn().mockResolvedValue(undefined),
    onToolCallEvent: vi.fn(),
  },
}));

vi.mock('../system-logger.js', () => ({
  systemLogger: {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { executeTools, type ToolExecutionInput } from './tool-executor.js';
import { addTool } from '../tools.js';
import type { Tool } from '../tool-system.js';

function makeToolCall(
  name: string,
  args: Record<string, unknown> = {}
): ToolCall {
  return {
    function: {
      name,
      arguments: args,
    },
  };
}

function makeExecutionInput(
  toolCalls: ToolCall[],
  overrides: Partial<ToolExecutionInput> = {}
): ToolExecutionInput {
  return {
    toolCalls,
    conversationType: 'chat',
    isTainted: false,
    taintedToolNames: new Set(),
    callBatchId: 'batch-1',
    ...overrides,
  };
}

function makeTool(
  name: string,
  taintStatus?: 'clean' | 'tainted' | 'secure',
  execute?: () => Promise<string>
): void {
  addTool({
    name,
    availableFor: ['chat'],
    description: `Test tool: ${name}`,
    systemPromptFragment: '',
    parameters: {} as never,
    taintStatus,
    execute: execute ?? vi.fn().mockResolvedValue('result'),
  } as Tool);
}

describe('executeTools', () => {
  beforeEach(() => {
    toolRegistry.length = 0;
    vi.clearAllMocks();
  });

  it('returns an error for an unrecognized tool', async () => {
    const input = makeExecutionInput([makeToolCall('ghost-tool')]);

    const result = await executeTools(input);

    expect(result.toolResultMessages).toHaveLength(1);
    expect(result.toolResultMessages[0].content).toContain('not recognized');
    expect(result.taintedToolNamesAdded).toHaveLength(0);
  });

  it('executes a clean tool and returns its result', async () => {
    makeTool('clean-tool', 'clean');
    const input = makeExecutionInput([makeToolCall('clean-tool')]);

    const result = await executeTools(input);

    expect(result.toolResultMessages).toHaveLength(1);
    expect(result.toolResultMessages[0].content).toBe('result');
    expect(result.toolResultMessages[0].tool_name).toBe('clean-tool');
    expect(result.taintedToolNamesAdded).toHaveLength(0);
  });

  it('adds tainted tool to taintedToolNamesAdded when executing tainted tool', async () => {
    makeTool('tainted-tool', 'tainted');
    const input = makeExecutionInput([makeToolCall('tainted-tool')]);

    const result = await executeTools(input);

    expect(result.toolResultMessages).toHaveLength(1);
    expect(result.taintedToolNamesAdded).toEqual(['tainted-tool']);
  });

  it('blocks secure tool when conversation is already tainted', async () => {
    makeTool('secure-tool', 'secure');
    const input = makeExecutionInput([makeToolCall('secure-tool')], {
      isTainted: true,
      taintedToolNames: new Set(['evil-tool']),
    });

    const result = await executeTools(input);

    expect(result.toolResultMessages).toHaveLength(1);
    expect(result.toolResultMessages[0].content).toContain('secure tool');
    expect(result.toolResultMessages[0].content).toContain('evil-tool');
    // execute should NOT have been called because taint blocked it
    const toolDef = toolRegistry.find(t => t.name === 'secure-tool');
    expect(toolDef?.execute).not.toHaveBeenCalled();
    expect(result.taintedToolNamesAdded).toHaveLength(0);
  });

  it('allows secure tool when conversation is not tainted', async () => {
    makeTool('secure-tool', 'secure');
    const input = makeExecutionInput([makeToolCall('secure-tool')]);

    const result = await executeTools(input);

    expect(result.toolResultMessages[0].content).toBe('result');
  });

  it('returns error message when tool execution throws', async () => {
    makeTool(
      'flaky-tool',
      'clean',
      vi.fn().mockRejectedValue(new Error('boom'))
    );
    const input = makeExecutionInput([makeToolCall('flaky-tool')]);

    const result = await executeTools(input);

    expect(result.toolResultMessages[0].content).toBe('Error: boom');
  });

  it('handles multiple tool calls in parallel', async () => {
    makeTool('tool-a', 'clean');
    makeTool('tool-b', 'clean');
    const input = makeExecutionInput([
      makeToolCall('tool-a'),
      makeToolCall('tool-b'),
    ]);

    const result = await executeTools(input);

    expect(result.toolResultMessages).toHaveLength(2);
    expect(result.toolResultMessages.map(m => m.tool_name).sort()).toEqual([
      'tool-a',
      'tool-b',
    ]);
  });

  it('dispatches tool_call_started and tool_call_completed events', async () => {
    const { ToolCallEvents } = await import('../tool-system.js');
    makeTool('event-tool', 'clean');
    const input = makeExecutionInput([makeToolCall('event-tool')]);

    await executeTools(input);

    const dispatch = ToolCallEvents.dispatchToolCallEvent as ReturnType<
      typeof vi.fn
    >;
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool_call_started' })
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool_call_completed' })
    );
  });
});
