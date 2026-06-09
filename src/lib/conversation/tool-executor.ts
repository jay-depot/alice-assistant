import type { LlmToolCall } from '../llm-provider.js';
import { getTools } from '../tools.js';
import { ToolCallEvents, type Tool } from '../tool-system.js';
import { systemLogger } from '../system-logger.js';
import type { DynamicPromptConversationType } from '../dynamic-prompt.js';

export type ToolExecutionInput = {
  toolCalls: LlmToolCall[];
  conversationType: DynamicPromptConversationType;
  isTainted: boolean;
  taintedToolNames: Set<string>;
  sessionId?: number;
  taskAssistantId?: string;
  agentInstanceId?: string;
  callBatchId: string;
};

export type ToolResultMessage = {
  role: 'tool';
  content: string;
  tool_name: string;
  tool_call_id?: string;
};

export type ToolExecutionOutput = {
  toolResultMessages: ToolResultMessage[];
  taintedToolNamesAdded: string[];
};

function buildSecureLockedMessage(
  toolName: string,
  taintedToolNames: Set<string>
): string {
  return (
    `Tool ${toolName} is a secure tool and cannot be used in this conversation ` +
    `because the conversation context has been tainted by a previous tool call ` +
    `(${[...taintedToolNames].join(', ')}). ` +
    `Inform the user that if they still want to take this action, they need to ` +
    `start a new conversation.`
  );
}

function truncateResult(result: string): string {
  return result.length > 200 ? result.slice(0, 200) + '\u2026' : result;
}

async function executeSingleTool(
  toolCall: LlmToolCall,
  tool: Tool,
  input: ToolExecutionInput
): Promise<ToolResultMessage> {
  const toolName = toolCall.function.name;
  const toolArgs = toolCall.function.arguments;

  void ToolCallEvents.dispatchToolCallEvent({
    type: 'tool_call_started',
    callBatchId: input.callBatchId,
    toolName,
    toolArgs,
    conversationType: input.conversationType,
    sessionId: input.sessionId,
    taskAssistantId: input.taskAssistantId,
    agentInstanceId: input.agentInstanceId,
    requiresApproval: tool.requiresApproval,
    timestamp: new Date().toISOString(),
  });

  try {
    const callResult = await tool.execute(toolArgs, {
      toolName,
      conversationType: input.conversationType,
      sessionId: input.sessionId,
      taskAssistantId: input.taskAssistantId,
      agentInstanceId: input.agentInstanceId,
    });

    await ToolCallEvents.dispatchToolCallEvent({
      type: 'tool_call_completed',
      callBatchId: input.callBatchId,
      toolName,
      toolArgs,
      conversationType: input.conversationType,
      sessionId: input.sessionId,
      taskAssistantId: input.taskAssistantId,
      agentInstanceId: input.agentInstanceId,
      resultSummary: truncateResult(callResult),
      requiresApproval: tool.requiresApproval,
      timestamp: new Date().toISOString(),
    });

    return {
      role: 'tool' as const,
      content: callResult,
      tool_name: toolName,
      tool_call_id: toolCall.id,
    };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);

    await ToolCallEvents.dispatchToolCallEvent({
      type: 'tool_call_error',
      callBatchId: input.callBatchId,
      toolName,
      toolArgs,
      conversationType: input.conversationType,
      sessionId: input.sessionId,
      taskAssistantId: input.taskAssistantId,
      agentInstanceId: input.agentInstanceId,
      error: errorMessage,
      requiresApproval: tool.requiresApproval,
      timestamp: new Date().toISOString(),
    });

    return {
      role: 'tool' as const,
      content: `Error: ${errorMessage}`,
      tool_name: toolName,
      tool_call_id: toolCall.id,
    };
  }
}

/**
 * Unified tool-call execution — used by both the non-streaming
 * (`handleToolCalls`) and streaming (`executeToolCalls`) paths.
 *
 * Returns tool-result messages and a list of newly tainted tool names.
 * The caller is responsible for appending results to the conversation
 * context and updating taintedToolNames.
 */
export async function executeTools(
  input: ToolExecutionInput
): Promise<ToolExecutionOutput> {
  const tools = getTools(input.conversationType);
  const taintedToolNamesAdded: string[] = [];

  const toolResultMessages: ToolResultMessage[] = await Promise.all(
    input.toolCalls.map(async toolCall => {
      const toolName = toolCall.function.name;
      const toolArgs = toolCall.function.arguments;
      systemLogger.log(JSON.stringify({ toolName, toolArgs }));

      const tool = tools.find(t => t.name === toolName);
      if (!tool) {
        return {
          role: 'tool' as const,
          content: `Tool ${toolName} is not recognized.`,
          tool_name: toolName,
          tool_call_id: toolCall.id,
        };
      }

      const effectiveTaint = tool.taintStatus ?? 'clean';
      if (effectiveTaint === 'secure' && input.isTainted) {
        return {
          role: 'tool' as const,
          content: buildSecureLockedMessage(toolName, input.taintedToolNames),
          tool_name: toolName,
          tool_call_id: toolCall.id,
        };
      }

      const result = await executeSingleTool(toolCall, tool, input);

      if (effectiveTaint === 'tainted') {
        taintedToolNamesAdded.push(toolName);
      }

      return result;
    })
  );

  return { toolResultMessages, taintedToolNamesAdded };
}
