import { randomUUID } from 'node:crypto';
import { startConversation, type Conversation } from './conversation.js';
import type { ConversationTypeId } from './conversation-types.js';
import type { Tool } from './tool-system.js';
import type { TSchema } from 'typebox';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionLinkedAgentStatus =
  | 'running'
  | 'cancelled'
  | 'erroring'
  | 'completed';

export type PendingAgentMessage = {
  heading: string;
  content: string;
};

export type SessionLinkedAgentUpdate = {
  linkedSessionId: number;
  agentInstanceId: string;
  agentName: string;
  kind: 'progress' | 'result';
  heading: string;
  content: string;
};

export type SessionLinkedAgentResult = {
  summary: string;
  report: string;
};

export type SessionLinkedAgentInstance = {
  instanceId: string;
  agentId: string;
  agentName: string;
  linkedSessionId: number;
  status: SessionLinkedAgentStatus;
  conversation: Conversation;
  startedAt: Date;
  pendingMessages: PendingAgentMessage[];
  startArgs: Record<string, unknown>;
};

export type SessionLinkedAgentDefinition = {
  id: string;
  name: string;
  conversationType: ConversationTypeId;
  /**
   * Optional max number of synthetic user-turn iterations to run before forcing completion.
   * Defaults to 8.
   */
  maxIterations?: number;
  /**
   * Synthetic user prompt sent between autonomous agent turns.
   */
  continuationPrompt?: string;
  /**
   * Synthetic user prompt sent when max iterations are reached and the agent must finish.
   */
  forceReturnPrompt?: string;
  startToolName: string;
  startToolDescription: string;
  startToolParameters: TSchema;
  startToolAvailableFor: ConversationTypeId[];
  startToolSystemPromptFragment: Tool['systemPromptFragment'];
  startToolResultPromptOutro?: Tool['toolResultPromptOutro'];
  buildStartup: (args: Record<string, unknown>) => Promise<{
    agentContextPrompt: string;
    kickoffUserMessage: string;
  }>;
  buildResult: (
    rawResult: SessionLinkedAgentResult,
    startArgs: Record<string, unknown>
  ) => Promise<{
    handbackMessage: string;
    outputText?: string;
    outputArtifacts?: string[];
  }>;
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const definitions = new Map<
  string,
  { definition: SessionLinkedAgentDefinition; pluginId: string }
>();
const activeInstancesById = new Map<string, SessionLinkedAgentInstance>();
const activeInstancesBySession = new Map<number, Set<string>>();
const agentUpdateCallbacks: Array<
  (update: SessionLinkedAgentUpdate) => Promise<void>
> = [];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_MAX_AGENT_ITERATIONS = 8;
const DEFAULT_CONTINUATION_PROMPT =
  'Continue your research. Use your available tools to gather more information. ' +
  'Call agentReportProgress to share any new findings. ' +
  'Call agentReturnResult when you have sufficient coverage to answer the research question.';
const DEFAULT_FORCE_RETURN_PROMPT =
  'You have reached the maximum number of research iterations. ' +
  'You must call agentReturnResult now with what you have gathered, even if incomplete.';

async function runAgentLoop(
  definition: SessionLinkedAgentDefinition,
  instance: SessionLinkedAgentInstance,
  agentContextPrompt: string,
  kickoffUserMessage: string
): Promise<void> {
  try {
    const maxIterations =
      definition.maxIterations ?? DEFAULT_MAX_AGENT_ITERATIONS;
    const continuationPrompt =
      definition.continuationPrompt ?? DEFAULT_CONTINUATION_PROMPT;
    const forceReturnPrompt =
      definition.forceReturnPrompt ?? DEFAULT_FORCE_RETURN_PROMPT;

    if (agentContextPrompt) {
      await instance.conversation.appendExternalMessage({
        role: 'system',
        content: agentContextPrompt,
      });
    }

    await instance.conversation.sendUserMessage(kickoffUserMessage);

    let iterations = 1;
    while (instance.status === 'running' && iterations < maxIterations) {
      await instance.conversation.sendUserMessage(continuationPrompt);
      iterations++;
    }

    if (instance.status === 'running') {
      await instance.conversation.sendUserMessage(forceReturnPrompt);
    }
  } catch (error) {
    if (instance.status === 'running') {
      instance.status = 'erroring';
    }
    console.error(
      `Agent ${instance.agentId} (instance ${instance.instanceId}) encountered an error:`,
      error
    );
  }
}

function addInstanceToMaps(instance: SessionLinkedAgentInstance): void {
  activeInstancesById.set(instance.instanceId, instance);
  let sessionSet = activeInstancesBySession.get(instance.linkedSessionId);
  if (!sessionSet) {
    sessionSet = new Set<string>();
    activeInstancesBySession.set(instance.linkedSessionId, sessionSet);
  }
  sessionSet.add(instance.instanceId);
}

function removeInstanceFromMaps(instance: SessionLinkedAgentInstance): void {
  activeInstancesById.delete(instance.instanceId);
  const sessionSet = activeInstancesBySession.get(instance.linkedSessionId);
  if (!sessionSet) {
    return;
  }

  sessionSet.delete(instance.instanceId);
  if (sessionSet.size === 0) {
    activeInstancesBySession.delete(instance.linkedSessionId);
  }
}

async function dispatchAgentUpdate(
  update: SessionLinkedAgentUpdate
): Promise<boolean> {
  if (agentUpdateCallbacks.length === 0) {
    return false;
  }

  await Promise.all(agentUpdateCallbacks.map(callback => callback(update)));
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const AgentSystem = {
  onUpdate(
    callback: (update: SessionLinkedAgentUpdate) => Promise<void>
  ): void {
    agentUpdateCallbacks.push(callback);
  },

  registerDefinition(
    pluginId: string,
    definition: SessionLinkedAgentDefinition
  ): void {
    if (definitions.has(definition.id)) {
      const existing = definitions.get(definition.id)!;
      throw new Error(
        `Plugin ${pluginId} attempted to register an agent with id "${definition.id}", ` +
          `but that id is already registered by plugin ${existing.pluginId}. ` +
          `Disable one of these plugins to fix your assistant.`
      );
    }
    definitions.set(definition.id, { definition, pluginId });
  },

  generateStartTool(definition: SessionLinkedAgentDefinition): Tool {
    return {
      name: definition.startToolName,
      availableFor: definition.startToolAvailableFor,
      description: definition.startToolDescription,
      parameters: definition.startToolParameters,
      systemPromptFragment: definition.startToolSystemPromptFragment,
      toolResultPromptIntro: '',
      toolResultPromptOutro: definition.startToolResultPromptOutro ?? '',
      execute: async (args, context) => {
        if (!context.sessionId) {
          throw new Error(
            `${definition.startToolName} requires an active chat session.`
          );
        }

        const instanceId = randomUUID();
        const instance: SessionLinkedAgentInstance = {
          instanceId,
          agentId: definition.id,
          agentName: definition.name,
          linkedSessionId: context.sessionId,
          status: 'running',
          conversation: startConversation(definition.conversationType, {
            sessionId: context.sessionId,
            agentInstanceId: instanceId,
          }),
          startedAt: new Date(),
          pendingMessages: [],
          startArgs: args,
        };

        addInstanceToMaps(instance);

        definition
          .buildStartup(args)
          .then(({ agentContextPrompt, kickoffUserMessage }) => {
            void runAgentLoop(
              definition,
              instance,
              agentContextPrompt,
              kickoffUserMessage
            );
          })
          .catch(error => {
            instance.status = 'erroring';
            console.error(
              `Agent ${definition.id} failed to build startup context:`,
              error
            );
          });

        return (
          `${definition.name} has started and is researching in the background. ` +
          `Progress updates and the final result will appear in subsequent messages.`
        );
      },
    };
  },

  async reportProgress(instanceId: string, message: string): Promise<void> {
    const instance = activeInstancesById.get(instanceId);
    if (!instance || instance.status !== 'running') {
      return;
    }

    const pendingMessage = {
      heading: `Progress Update from ${instance.agentName}`,
      content: message,
    };
    instance.pendingMessages.push(pendingMessage);

    try {
      const delivered = await dispatchAgentUpdate({
        linkedSessionId: instance.linkedSessionId,
        agentInstanceId: instance.instanceId,
        agentName: instance.agentName,
        kind: 'progress',
        heading: pendingMessage.heading,
        content: pendingMessage.content,
      });

      if (delivered) {
        instance.pendingMessages = instance.pendingMessages.filter(
          queuedMessage => queuedMessage !== pendingMessage
        );
      }
    } catch (error) {
      console.error(
        `Failed to deliver progress update for agent ${instance.agentId} (${instance.instanceId}):`,
        error
      );
    }
  },

  async returnResult(
    instanceId: string,
    rawResult: SessionLinkedAgentResult
  ): Promise<void> {
    const instance = activeInstancesById.get(instanceId);
    if (!instance) {
      return;
    }

    const entry = definitions.get(instance.agentId);
    if (!entry) {
      instance.status = 'erroring';
      return;
    }

    const built = await entry.definition.buildResult(
      rawResult,
      instance.startArgs
    );

    const resultLines = [
      built.handbackMessage,
      '',
      `**Summary:** ${rawResult.summary}`,
      '',
      rawResult.report,
    ];
    if (built.outputArtifacts && built.outputArtifacts.length > 0) {
      resultLines.push('', `**Saved to:** ${built.outputArtifacts.join(', ')}`);
    }

    const pendingMessage = {
      heading: `Final Result from ${instance.agentName}`,
      content: resultLines.join('\n'),
    };
    instance.pendingMessages.push(pendingMessage);

    instance.status = 'completed';

    try {
      const delivered = await dispatchAgentUpdate({
        linkedSessionId: instance.linkedSessionId,
        agentInstanceId: instance.instanceId,
        agentName: instance.agentName,
        kind: 'result',
        heading: pendingMessage.heading,
        content: pendingMessage.content,
      });

      if (delivered) {
        removeInstanceFromMaps(instance);
      }
    } catch (error) {
      console.error(
        `Failed to deliver final result for agent ${instance.agentId} (${instance.instanceId}):`,
        error
      );
    }
  },

  getAndClearPendingMessages(sessionId: number): PendingAgentMessage[] {
    const instanceIds = activeInstancesBySession.get(sessionId);
    if (!instanceIds || instanceIds.size === 0) {
      return [];
    }

    const messages: PendingAgentMessage[] = [];
    const toRemove: string[] = [];

    for (const instanceId of instanceIds) {
      const instance = activeInstancesById.get(instanceId);
      if (!instance) continue;
      messages.push(...instance.pendingMessages);
      instance.pendingMessages = [];

      // Clean up instances that have finished running once their messages are drained
      if (instance.status !== 'running') {
        toRemove.push(instanceId);
      }
    }

    for (const instanceId of toRemove) {
      activeInstancesById.delete(instanceId);
      instanceIds.delete(instanceId);
    }
    if (instanceIds.size === 0) {
      activeInstancesBySession.delete(sessionId);
    }

    return messages;
  },

  cancelBySession(sessionId: number): void {
    const instanceIds = activeInstancesBySession.get(sessionId);
    if (!instanceIds) return;

    for (const instanceId of [...instanceIds]) {
      const instance = activeInstancesById.get(instanceId);
      if (instance && instance.status === 'running') {
        instance.status = 'cancelled';
      }
      activeInstancesById.delete(instanceId);
    }
    activeInstancesBySession.delete(sessionId);
  },

  getInstancesBySession(sessionId: number): SessionLinkedAgentInstance[] {
    const instanceIds = activeInstancesBySession.get(sessionId);
    if (!instanceIds) return [];
    return [...instanceIds]
      .map(id => activeInstancesById.get(id))
      .filter(
        (instance): instance is SessionLinkedAgentInstance =>
          instance !== undefined && instance.status === 'running'
      );
  },
};
