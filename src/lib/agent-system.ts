import { randomUUID } from 'node:crypto';
import {
  startConversation,
  type Conversation,
  type Message,
} from './conversation.js';
import type { ConversationTypeId } from './conversation-types.js';
import type { Tool } from './tool-system.js';
import type { TSchema } from 'typebox';
import { systemLogger } from './system-logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionLinkedAgentStatus =
  | 'running'
  | 'cancelled'
  | 'erroring'
  | 'completed';

export type IndependentAgentStatus =
  | 'hatching'
  | 'running'
  | 'sleeping'
  | 'paused'
  | 'freezing'
  | 'frozen'
  | 'thawing'
  | 'stuck'
  | 'forkingToChat'
  | 'erroring';

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

// ---------------------------------------------------------------------------
// State machine: valid transitions
// ---------------------------------------------------------------------------

/**
 * Core-controlled transitions are driven by the runtime (freeze, thaw, mark
 * stuck, mark erroring). Plugin-declared transitions are initiated by the
 * plugin via the control object (mark running, sleeping, paused, forkingToChat).
 */
const VALID_TRANSITIONS: Record<
  IndependentAgentStatus,
  Set<IndependentAgentStatus>
> = {
  hatching: new Set(['running', 'sleeping', 'erroring']),
  running: new Set([
    'sleeping',
    'paused',
    'freezing',
    'stuck',
    'forkingToChat',
    'erroring',
  ]),
  sleeping: new Set(['running', 'paused', 'freezing', 'stuck', 'erroring']),
  paused: new Set(['running', 'sleeping', 'freezing', 'erroring']),
  freezing: new Set(['frozen', 'erroring']),
  frozen: new Set(['thawing', 'erroring']),
  thawing: new Set(['running', 'sleeping', 'erroring']),
  stuck: new Set(['running', 'sleeping', 'paused', 'freezing', 'erroring']),
  forkingToChat: new Set(['running', 'sleeping', 'erroring']),
  erroring: new Set([]),
};

export type IndependentAgentInstance = {
  instanceId: string;
  agentId: string;
  agentName: string;
  description: string;
  conversationType: ConversationTypeId;
  status: IndependentAgentStatus;
  statusMessage?: string;
  startedAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  lastStateChangeAt: Date;
};

export type IndependentAgentControl = {
  /** Plugin declares it is actively working. */
  markRunning: (statusMessage?: string) => void;
  /** Plugin declares it is idle and waiting for work. */
  markSleeping: (statusMessage?: string) => void;
  /** Plugin declares it is paused (e.g. waiting for external signal). */
  markPaused: (statusMessage?: string) => void;
  /** Plugin declares it wants to hand off to a chat conversation. */
  markForkingToChat: (statusMessage?: string) => void;
  /** Report a heartbeat / activity to reset the stuck timer. */
  reportActivity: () => void;
  /** Read the current instance snapshot. */
  getInstance: () => IndependentAgentInstance;
};

export type IndependentAgentDefinition = {
  id: string;
  name: string;
  description: string;
  conversationType: ConversationTypeId;
  /** Called when the agent is started (hatching → running/sleeping). */
  start: (control: IndependentAgentControl) => Promise<void>;
  /** Called when the agent is being stopped or the system is shutting down. */
  stop?: (control: IndependentAgentControl) => Promise<void>;
  /** Called when the runtime needs to freeze the agent for persistence. Should return serializable state. */
  freeze?: (
    control: IndependentAgentControl
  ) => Promise<Record<string, unknown> | undefined>;
  /** Called when the runtime is restoring a previously frozen agent. Receives the state from freeze(). */
  thaw?: (
    frozenState: Record<string, unknown>,
    control: IndependentAgentControl
  ) => Promise<void>;
  /** Called when an external supervisor pauses the agent. Use to stop timers, release resources, etc. */
  onPause?: (control: IndependentAgentControl) => Promise<void>;
  /** Called when an external supervisor resumes a paused agent, or wakes a sleeping agent on schedule. */
  onResume?: (control: IndependentAgentControl) => Promise<void>;
  /** Called when an external supervisor suspends a stuck agent. Use to stop timers, release resources, etc. */
  onSuspend?: (control: IndependentAgentControl) => Promise<void>;
};

export type RegisteredIndependentAgentHandle = {
  start: () => Promise<IndependentAgentInstance>;
  stop: () => Promise<void>;
  /** Pause a running or sleeping agent. */
  pause: () => Promise<void>;
  /** Resume a paused agent, or wake a sleeping agent. */
  resume: () => Promise<void>;
  /** Suspend a stuck agent (transitions to sleeping for recovery). */
  suspend: () => Promise<void>;
  /** Freeze the agent for persistence. Returns the frozen state or undefined. */
  freeze: () => Promise<Record<string, unknown> | undefined>;
  /** Thaw a previously frozen agent with the given state. */
  thaw: (frozenState: Record<string, unknown>) => Promise<void>;
  getInstance: () => IndependentAgentInstance | undefined;
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
const independentDefinitions = new Map<
  string,
  { definition: IndependentAgentDefinition; pluginId: string }
>();
const activeInstancesById = new Map<string, SessionLinkedAgentInstance>();
const activeInstancesBySession = new Map<number, Set<string>>();
const activeIndependentInstancesById = new Map<
  string,
  IndependentAgentInstance
>();
const agentUpdateCallbacks: Array<
  (update: SessionLinkedAgentUpdate) => Promise<void>
> = [];
const independentAgentUpdateCallbacks: Array<
  (instance: IndependentAgentInstance) => void
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
    systemLogger.error(
      `Agent ${instance.agentId} (instance ${instance.instanceId}) encountered an error:`,
      error
    );
  }
}

// ---------------------------------------------------------------------------
// Independent agent loop helper
// ---------------------------------------------------------------------------

const DEFAULT_INDEPENDENT_MAX_ITERATIONS = 20;
const DEFAULT_INDEPENDENT_CONTINUATION_PROMPT =
  'Continue your task. Call agentSleep when you have no more work to do.';
const DEFAULT_INDEPENDENT_FORCE_SLEEP_PROMPT =
  'You have reached the maximum number of iterations. Call agentSleep now with a brief reason.';

export type RunIndependentAgentLoopOptions = {
  /** The conversation to use for LLM turns. */
  conversation: Conversation;
  /** The agent ID (used to check status and report activity). */
  agentId: string;
  /** The first user message sent to the LLM. */
  kickoffUserMessage: string;
  /** Synthetic prompt sent between autonomous turns. */
  continuationPrompt?: string;
  /** Max iterations before forcing sleep. Default: 20. */
  maxIterations?: number;
  /** Called when the loop exits because the agent went to sleep. */
  onSleep?: (reason: string) => Promise<void>;
};

/**
 * Run an autonomous LLM loop for an independent agent. The loop sends
 * kickoff and continuation prompts, auto-compacts after each iteration,
 * and exits when the agent transitions to `sleeping` (typically via the
 * `agentSleep` tool) or when max iterations are reached.
 *
 * Unlike the session-linked `runAgentLoop`, this loop exits on sleep
 * rather than forcing completion — the agent is expected to wake again later.
 */
export async function runIndependentAgentLoop(
  options: RunIndependentAgentLoopOptions
): Promise<void> {
  const {
    conversation,
    agentId,
    kickoffUserMessage,
    continuationPrompt = DEFAULT_INDEPENDENT_CONTINUATION_PROMPT,
    maxIterations = DEFAULT_INDEPENDENT_MAX_ITERATIONS,
    onSleep,
  } = options;

  try {
    await conversation.sendUserMessage(kickoffUserMessage);

    let iterations = 1;
    while (iterations < maxIterations) {
      // Check if agent is still running before continuing
      const instance = AgentSystem.getIndependentInstance(agentId);
      if (!instance || instance.status !== 'running') {
        break;
      }

      // Report activity to prevent stuck detection from firing during
      // long-running LLM turns or tool calls.
      AgentSystem.reportIndependentAgentActivity(agentId);

      await conversation.sendUserMessage(continuationPrompt);
      iterations++;

      // Auto-compact after each iteration
      await conversation.compactContext('normal');
    }

    // If still running after max iterations, force sleep
    const instance = AgentSystem.getIndependentInstance(agentId);
    if (instance?.status === 'running') {
      await conversation.sendUserMessage(
        DEFAULT_INDEPENDENT_FORCE_SLEEP_PROMPT
      );
    }

    // If the agent went to sleep, notify the caller
    const finalInstance = AgentSystem.getIndependentInstance(agentId);
    if (finalInstance?.status === 'sleeping' && onSleep) {
      await onSleep(finalInstance.statusMessage ?? 'Agent went to sleep.');
    }
  } catch (error) {
    const instance = AgentSystem.getIndependentInstance(agentId);
    if (instance && instance.status === 'running') {
      transitionIndependentAgentStatus(
        instance,
        'erroring',
        `runIndependentAgentLoop threw: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    systemLogger.error(
      `Independent agent ${agentId} loop encountered an error:`,
      error
    );
  }
}

// ---------------------------------------------------------------------------
// Conversation state serialization helpers
// ---------------------------------------------------------------------------

const CONVERSATION_CONTEXT_KEY = 'conversationContext';
const CONVERSATION_COMPACTED_KEY = 'conversationCompacted';

/**
 * Serialize a Conversation's context into a frozen-state object suitable for
 * persistence. Extra fields are merged into the result.
 *
 * Use this in your agent's `freeze()` callback.
 */
export function serializeConversationState(
  conversation: Conversation,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    [CONVERSATION_CONTEXT_KEY]: conversation.rawContext as unknown,
    [CONVERSATION_COMPACTED_KEY]: conversation.compactedContext as unknown,
    ...extra,
  };
}

/**
 * Restore a Conversation from a previously serialized frozen state.
 * Creates a fresh Conversation and calls `restoreContext()` on it.
 *
 * Returns the restored Conversation and any extra fields that were not
 * part of the conversation context serialization.
 *
 * Use this in your agent's `thaw()` callback.
 */
export function restoreConversationState(
  frozenState: Record<string, unknown>,
  conversationType: ConversationTypeId,
  agentInstanceId: string
): {
  conversation: Conversation;
  extra: Record<string, unknown>;
} {
  const conversationContext = frozenState[CONVERSATION_CONTEXT_KEY] as
    | Message[]
    | undefined;
  const conversationCompacted = frozenState[CONVERSATION_COMPACTED_KEY] as
    | Message[]
    | undefined;

  const conversation = startConversation(conversationType, {
    agentInstanceId,
  });

  if (conversationContext) {
    conversation.restoreContext(
      conversationContext,
      conversationCompacted ?? conversationContext
    );
  }

  // Extract extra fields (anything not part of the conversation serialization)
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frozenState)) {
    if (
      key !== CONVERSATION_CONTEXT_KEY &&
      key !== CONVERSATION_COMPACTED_KEY
    ) {
      extra[key] = value;
    }
  }

  return { conversation, extra };
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

function transitionIndependentAgentStatus(
  instance: IndependentAgentInstance,
  nextStatus: IndependentAgentStatus,
  statusMessage?: string
): void {
  const allowed = VALID_TRANSITIONS[instance.status];
  if (!allowed.has(nextStatus)) {
    systemLogger.warn(
      `Independent agent ${instance.agentId}: invalid transition ` +
        `${instance.status} → ${nextStatus}. Ignoring.`
    );
    return;
  }

  instance.status = nextStatus;
  instance.statusMessage = statusMessage;
  instance.lastStateChangeAt = new Date();
  instance.updatedAt = new Date();

  dispatchIndependentAgentUpdate(instance);
}

function createIndependentAgentControl(
  instance: IndependentAgentInstance
): IndependentAgentControl {
  return {
    markRunning: statusMessage => {
      transitionIndependentAgentStatus(instance, 'running', statusMessage);
    },
    markSleeping: statusMessage => {
      transitionIndependentAgentStatus(instance, 'sleeping', statusMessage);
    },
    markPaused: statusMessage => {
      transitionIndependentAgentStatus(instance, 'paused', statusMessage);
    },
    markForkingToChat: statusMessage => {
      transitionIndependentAgentStatus(
        instance,
        'forkingToChat',
        statusMessage
      );
    },
    reportActivity: () => {
      instance.lastActivityAt = new Date();
      instance.updatedAt = new Date();
    },
    getInstance: () => instance,
  };
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

function dispatchIndependentAgentUpdate(
  instance: IndependentAgentInstance
): void {
  if (independentAgentUpdateCallbacks.length === 0) {
    return;
  }

  for (const callback of independentAgentUpdateCallbacks) {
    try {
      callback(instance);
    } catch (error) {
      systemLogger.error('Independent agent update callback threw:', error);
    }
  }
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

  registerIndependentDefinition(
    pluginId: string,
    definition: IndependentAgentDefinition
  ): RegisteredIndependentAgentHandle {
    if (independentDefinitions.has(definition.id)) {
      const existing = independentDefinitions.get(definition.id)!;
      throw new Error(
        `Plugin ${pluginId} attempted to register an independent agent with id "${definition.id}", ` +
          `but that id is already registered by plugin ${existing.pluginId}. ` +
          `Disable one of these plugins to fix your assistant.`
      );
    }

    independentDefinitions.set(definition.id, { definition, pluginId });

    return {
      start: () => AgentSystem.startIndependentAgent(definition.id),
      stop: () => AgentSystem.stopIndependentAgent(definition.id),
      pause: () => AgentSystem.pauseIndependentAgent(definition.id),
      resume: () => AgentSystem.resumeIndependentAgent(definition.id),
      suspend: () => AgentSystem.suspendIndependentAgent(definition.id),
      freeze: () => AgentSystem.freezeIndependentAgent(definition.id),
      thaw: frozenState =>
        AgentSystem.thawIndependentAgent(definition.id, frozenState),
      getInstance: () => AgentSystem.getIndependentInstance(definition.id),
    };
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
            systemLogger.error(
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

  async startIndependentAgent(
    agentId: string
  ): Promise<IndependentAgentInstance> {
    const existingInstance = activeIndependentInstancesById.get(agentId);
    if (existingInstance) {
      return existingInstance;
    }

    const entry = independentDefinitions.get(agentId);
    if (!entry) {
      throw new Error(
        `Attempted to start independent agent ${agentId}, but no such definition is registered.`
      );
    }

    const now = new Date();
    const instance: IndependentAgentInstance = {
      instanceId: randomUUID(),
      agentId: entry.definition.id,
      agentName: entry.definition.name,
      description: entry.definition.description,
      conversationType: entry.definition.conversationType,
      status: 'hatching',
      startedAt: now,
      updatedAt: now,
      lastActivityAt: now,
      lastStateChangeAt: now,
    };

    activeIndependentInstancesById.set(agentId, instance);

    try {
      await entry.definition.start(createIndependentAgentControl(instance));
    } catch (error) {
      transitionIndependentAgentStatus(
        instance,
        'erroring',
        error instanceof Error ? error.message : String(error)
      );
      systemLogger.error(
        `Independent agent ${agentId} (instance ${instance.instanceId}) encountered an error while starting:`,
        error
      );
    }

    return instance;
  },

  /**
   * Create an independent agent instance in `frozen` state without calling
   * its `start()` callback. Used when restoring from a checkpoint — the
   * caller should follow up with `thawIndependentAgent()` to restore state
   * and transition the agent to `sleeping`.
   *
   * Returns the instance so the caller can inspect it before thawing.
   */
  restoreIndependentAgent(agentId: string): IndependentAgentInstance {
    const existingInstance = activeIndependentInstancesById.get(agentId);
    if (existingInstance) {
      return existingInstance;
    }

    const entry = independentDefinitions.get(agentId);
    if (!entry) {
      throw new Error(
        `Attempted to restore independent agent ${agentId}, but no such definition is registered.`
      );
    }

    const now = new Date();
    const instance: IndependentAgentInstance = {
      instanceId: randomUUID(),
      agentId: entry.definition.id,
      agentName: entry.definition.name,
      description: entry.definition.description,
      conversationType: entry.definition.conversationType,
      status: 'frozen',
      statusMessage: 'Restored from checkpoint.',
      startedAt: now,
      updatedAt: now,
      lastActivityAt: now,
      lastStateChangeAt: now,
    };

    activeIndependentInstancesById.set(agentId, instance);
    return instance;
  },

  async stopIndependentAgent(agentId: string): Promise<void> {
    const instance = activeIndependentInstancesById.get(agentId);
    if (!instance) {
      return;
    }

    const entry = independentDefinitions.get(agentId);
    if (!entry) {
      activeIndependentInstancesById.delete(agentId);
      return;
    }

    try {
      if (entry.definition.stop) {
        await entry.definition.stop(createIndependentAgentControl(instance));
      }
    } catch (error) {
      systemLogger.error(
        `Independent agent ${agentId} (instance ${instance.instanceId}) encountered an error while stopping:`,
        error
      );
    } finally {
      activeIndependentInstancesById.delete(agentId);
    }
  },

  getIndependentInstance(
    agentId: string
  ): IndependentAgentInstance | undefined {
    return activeIndependentInstancesById.get(agentId);
  },

  getIndependentAgentIdByInstanceId(instanceId: string): string | undefined {
    for (const [agentId, instance] of activeIndependentInstancesById) {
      if (instance.instanceId === instanceId) {
        return agentId;
      }
    }
    return undefined;
  },

  getIndependentDefinitionPluginId(agentId: string): string | undefined {
    return independentDefinitions.get(agentId)?.pluginId;
  },

  getIndependentInstances(): IndependentAgentInstance[] {
    return [...activeIndependentInstancesById.values()].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
    );
  },

  /**
   * Update the lastActivityAt timestamp for an independent agent.
   * Called by runIndependentAgentLoop before each iteration to prevent
   * the stuck detection timer from misdiagnosing an active agent.
   */
  reportIndependentAgentActivity(agentId: string): void {
    const instance = activeIndependentInstancesById.get(agentId);
    if (instance) {
      instance.lastActivityAt = new Date();
      instance.updatedAt = new Date();
    }
  },

  onIndependentAgentUpdate(
    callback: (instance: IndependentAgentInstance) => void
  ): void {
    independentAgentUpdateCallbacks.push(callback);
  },

  async pauseIndependentAgent(agentId: string): Promise<void> {
    const instance = activeIndependentInstancesById.get(agentId);
    if (!instance) {
      return;
    }

    // Only pause agents in a pausable state
    const pausableStates: IndependentAgentStatus[] = [
      'running',
      'sleeping',
      'stuck',
    ];
    if (!pausableStates.includes(instance.status)) {
      systemLogger.warn(
        `Independent agent ${agentId}: cannot pause from state ${instance.status}. Ignoring.`
      );
      return;
    }

    const entry = independentDefinitions.get(agentId);
    if (entry?.definition.onPause) {
      try {
        await entry.definition.onPause(createIndependentAgentControl(instance));
      } catch (error) {
        transitionIndependentAgentStatus(
          instance,
          'erroring',
          `onPause threw: ${error instanceof Error ? error.message : String(error)}`
        );
        systemLogger.error(
          `Independent agent ${agentId} onPause threw:`,
          error
        );
        return;
      }
    }

    transitionIndependentAgentStatus(
      instance,
      'paused',
      'Paused by supervisor.'
    );
  },

  async resumeIndependentAgent(agentId: string): Promise<void> {
    const instance = activeIndependentInstancesById.get(agentId);
    if (!instance) {
      return;
    }

    // Resume works for both paused and sleeping agents.
    // Paused → running: user-initiated resume.
    // Sleeping → running: schedule or event-initiated wake.
    const resumableStates: IndependentAgentStatus[] = ['paused', 'sleeping'];
    if (!resumableStates.includes(instance.status)) {
      return;
    }

    const entry = independentDefinitions.get(agentId);
    if (entry?.definition.onResume) {
      try {
        await entry.definition.onResume(
          createIndependentAgentControl(instance)
        );
      } catch (error) {
        transitionIndependentAgentStatus(
          instance,
          'erroring',
          `onResume threw: ${error instanceof Error ? error.message : String(error)}`
        );
        systemLogger.error(
          `Independent agent ${agentId} onResume threw:`,
          error
        );
        return;
      }
    } else {
      // Default resume behavior: transition to running
      transitionIndependentAgentStatus(
        instance,
        'running',
        'Resumed by supervisor.'
      );
    }
  },

  async suspendIndependentAgent(agentId: string): Promise<void> {
    const instance = activeIndependentInstancesById.get(agentId);
    if (!instance || instance.status !== 'stuck') {
      return;
    }

    const entry = independentDefinitions.get(agentId);
    if (entry?.definition.onSuspend) {
      try {
        await entry.definition.onSuspend(
          createIndependentAgentControl(instance)
        );
      } catch (error) {
        transitionIndependentAgentStatus(
          instance,
          'erroring',
          `onSuspend threw: ${error instanceof Error ? error.message : String(error)}`
        );
        systemLogger.error(
          `Independent agent ${agentId} onSuspend threw:`,
          error
        );
        return;
      }
    }

    // Suspend transitions stuck → sleeping (recovery action)
    transitionIndependentAgentStatus(
      instance,
      'sleeping',
      'Suspended by supervisor.'
    );
  },

  async sleepIndependentAgent(agentId: string, reason: string): Promise<void> {
    const instance = activeIndependentInstancesById.get(agentId);
    if (!instance || !['running', 'stuck'].includes(instance.status)) {
      systemLogger.warn(
        `Independent agent ${agentId}: cannot sleep from state ${instance?.status ?? 'unknown'}. Ignoring.`
      );
      return;
    }

    transitionIndependentAgentStatus(instance, 'sleeping', reason);
  },

  markIndependentAgentStuck(agentId: string, statusMessage?: string): void {
    const instance = activeIndependentInstancesById.get(agentId);
    if (!instance) {
      return;
    }

    transitionIndependentAgentStatus(
      instance,
      'stuck',
      statusMessage ?? 'No activity detected. Agent may be stuck.'
    );
  },

  async freezeIndependentAgent(
    agentId: string
  ): Promise<Record<string, unknown> | undefined> {
    const instance = activeIndependentInstancesById.get(agentId);
    if (!instance) {
      return undefined;
    }

    // Only freeze agents in a freezable state
    const freezableStates: IndependentAgentStatus[] = [
      'running',
      'sleeping',
      'paused',
      'stuck',
    ];
    if (!freezableStates.includes(instance.status)) {
      systemLogger.warn(
        `Independent agent ${agentId}: cannot freeze from state ${instance.status}. Skipping.`
      );
      return undefined;
    }

    transitionIndependentAgentStatus(
      instance,
      'freezing',
      'Preparing to freeze.'
    );

    const entry = independentDefinitions.get(agentId);
    let frozenState: Record<string, unknown> | undefined;

    if (entry?.definition.freeze) {
      try {
        frozenState = await entry.definition.freeze(
          createIndependentAgentControl(instance)
        );
      } catch (error) {
        transitionIndependentAgentStatus(
          instance,
          'erroring',
          `freeze threw: ${error instanceof Error ? error.message : String(error)}`
        );
        systemLogger.error(`Independent agent ${agentId} freeze threw:`, error);
        return undefined;
      }
    }

    transitionIndependentAgentStatus(
      instance,
      'frozen',
      'Frozen for persistence.'
    );

    return frozenState;
  },

  async thawIndependentAgent(
    agentId: string,
    frozenState: Record<string, unknown>
  ): Promise<void> {
    const instance = activeIndependentInstancesById.get(agentId);
    if (!instance || instance.status !== 'frozen') {
      return;
    }

    transitionIndependentAgentStatus(
      instance,
      'thawing',
      'Restoring from frozen state.'
    );

    const entry = independentDefinitions.get(agentId);
    if (entry?.definition.thaw) {
      try {
        await entry.definition.thaw(
          frozenState,
          createIndependentAgentControl(instance)
        );
      } catch (error) {
        transitionIndependentAgentStatus(
          instance,
          'erroring',
          `thaw threw: ${error instanceof Error ? error.message : String(error)}`
        );
        systemLogger.error(`Independent agent ${agentId} thaw threw:`, error);
        return;
      }
    } else {
      // Default thaw: transition to sleeping
      transitionIndependentAgentStatus(
        instance,
        'sleeping',
        'Thawed with no custom state.'
      );
    }
  },

  async freezeAllIndependentAgents(): Promise<
    Map<string, Record<string, unknown> | undefined>
  > {
    const results = new Map<string, Record<string, unknown> | undefined>();

    for (const [agentId] of activeIndependentInstancesById) {
      try {
        const frozenState = await AgentSystem.freezeIndependentAgent(agentId);
        results.set(agentId, frozenState);
      } catch (error) {
        systemLogger.error(
          `Failed to freeze independent agent ${agentId}:`,
          error
        );
        results.set(agentId, undefined);
      }
    }

    return results;
  },

  async thawAllIndependentAgents(
    frozenStates: Map<string, Record<string, unknown> | undefined>
  ): Promise<void> {
    for (const [agentId, frozenState] of frozenStates) {
      if (!frozenState) {
        systemLogger.warn(
          `Independent agent ${agentId}: no frozen state available, skipping thaw.`
        );
        continue;
      }

      try {
        await AgentSystem.thawIndependentAgent(agentId, frozenState);
      } catch (error) {
        systemLogger.error(
          `Failed to thaw independent agent ${agentId}:`,
          error
        );
      }
    }
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
      systemLogger.error(
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
      systemLogger.error(
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
