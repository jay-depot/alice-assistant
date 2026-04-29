import { DynamicPromptConversationType } from '../dynamic-prompt.js';
import { getHeaderPrompts } from '../header-prompts.js';
import { getFooterPrompts } from '../footer-prompts.js';
import type { Message } from './types.js';

export type PromptAssemblerContext = {
  conversationType: DynamicPromptConversationType;
  sessionId?: number;
  taskAssistantId?: string;
  toolCallsAllowed: boolean;
  availableTools: string[];
};

/**
 * Fetches header and footer system prompts and combines them with the
 * compacted conversation context into a single message array suitable
 * for sending to Ollama.
 */
export async function assembleFullContext(
  ctx: PromptAssemblerContext,
  compactedContext: Message[]
): Promise<Message[]> {
  const headerPrompts = await getHeaderPrompts({
    conversationType: ctx.conversationType,
    sessionId: ctx.sessionId,
    taskAssistantId: ctx.taskAssistantId,
    toolCallsAllowed: ctx.toolCallsAllowed,
    availableTools: ctx.availableTools,
  });

  const footerPrompts = await getFooterPrompts({
    conversationType: ctx.conversationType,
    sessionId: ctx.sessionId,
    taskAssistantId: ctx.taskAssistantId,
    availableTools: ctx.availableTools,
  });

  return [
    ...headerPrompts.map(prompt => ({
      role: 'system' as const,
      content: prompt,
    })),
    ...compactedContext,
    ...footerPrompts.map(prompt => ({
      role: 'system' as const,
      content: prompt,
    })),
  ];
}
