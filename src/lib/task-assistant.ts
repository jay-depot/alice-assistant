import { randomUUID } from 'node:crypto';
import {
  startConversation,
  type Conversation,
  type Message,
} from './conversation.js';
import { systemLogger } from './system-logger.js';
import type { ConversationTypeId } from './conversation-types.js';
import type { Tool, ToolExecutionContext } from './tool-system.js';
import type { TSchema } from 'typebox';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TaskAssistantStatus =
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'error';

export type TaskAssistantEntryMode = 'chat' | 'voice';

export type TaskAssistantResult = {
  /** The id of the task assistant definition that produced this result. */
  taskAssistantId: string;
  /** The human-readable name of the task assistant. */
  taskAssistantName: string;
  /** The conversation type the task assistant used. */
  conversationType: ConversationTypeId;
  /** Final status of the task. */
  status: TaskAssistantStatus;
  /** A brief summary of what the task assistant accomplished. Used in the header prompt. */
  summary: string;
  /** The message the main assistant should relay or build on when speaking to the user. */
  handbackMessage: string;
  /** Optional longer text output from the task (e.g., organized notes). */
  outputText?: string;
  /** Optional list of file paths written by the task assistant. */
  outputArtifacts?: string[];
  /** Optional arbitrary metadata from the plugin. */
  pluginMetadata?: Record<string, unknown>;
};

export type TaskAssistantDefinition = {
  /** Unique identifier for this task assistant. Conventionally matches the plugin id. */
  id: string;
  /** Human-readable name shown to the user in chat message labels. */
  name: string;
  /** The conversation type used for this task assistant's Conversation instance. */
  conversationType: ConversationTypeId;
};

export type ActiveTaskAssistantInstance = {
  /** UUID for this specific active instance. */
  instanceId: string;
  /** The registered definition this instance was created from. */
  definition: TaskAssistantDefinition;
  /** The web-ui session id being served by this task assistant. */
  parentSessionId: number;
  /** Whether the task assistant was invoked by chat or voice. */
  entryMode: TaskAssistantEntryMode;
  /** The live Conversation object for this task assistant turn. */
  conversation: Conversation;
  /** When this instance was started. */
  startedAt: Date;
};

export type TaskAssistantSeedMessage = Pick<Message, 'role' | 'content'>;

export type TaskAssistantToolHandoffOptions = {
  definitionId: string;
  context: ToolExecutionContext;
  contextHints?: string;
  kickoffMessage?: string;
  initialMessages?: TaskAssistantSeedMessage[];
};

export type TaskAssistantCompletionOptions = {
  context: ToolExecutionContext;
  taskAssistantId?: string;
  status?: TaskAssistantStatus;
  summary: string;
  handbackMessage: string;
  outputText?: string;
  outputArtifacts?: string[];
  pluginMetadata?: Record<string, unknown>;
};

export type TaskAssistantStartToolFactoryOptions = {
  definitionId: string;
  name: string;
  availableFor: ConversationTypeId[];
  description: string;
  parameters: TSchema;
  systemPromptFragment: Tool['systemPromptFragment'];
  toolResultPromptIntro?: Tool['toolResultPromptIntro'];
  toolResultPromptOutro?: Tool['toolResultPromptOutro'];
  buildHandoff: (
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ) =>
    | Promise<Omit<TaskAssistantToolHandoffOptions, 'definitionId' | 'context'>>
    | Omit<TaskAssistantToolHandoffOptions, 'definitionId' | 'context'>;
};

export type TaskAssistantCompletionToolFactoryOptions = {
  name: string;
  description: string;
  parameters: TSchema;
  systemPromptFragment: Tool['systemPromptFragment'];
  toolResultPromptIntro?: Tool['toolResultPromptIntro'];
  toolResultPromptOutro?: Tool['toolResultPromptOutro'];
  buildCompletion: (
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ) =>
    | Promise<Omit<TaskAssistantCompletionOptions, 'context'>>
    | Omit<TaskAssistantCompletionOptions, 'context'>;
  formatResult?: (result: TaskAssistantResult) => string;
};

export type TaskAssistantToolPairFactoryOptions = {
  start: TaskAssistantStartToolFactoryOptions;
  complete: TaskAssistantCompletionToolFactoryOptions;
};

function requireToolContextSessionId(context: ToolExecutionContext): number {
  if (!context.sessionId) {
    throw new Error(
      `Tool ${context.toolName} requires an active chat or voice session.`
    );
  }

  return context.sessionId;
}

function getEntryModeFromToolContext(
  context: ToolExecutionContext
): TaskAssistantEntryMode {
  return context.conversationType === 'voice' ? 'voice' : 'chat';
}

function requireTaskAssistantDefinitionForContext(
  context: ToolExecutionContext,
  explicitTaskAssistantId?: string
): TaskAssistantDefinition {
  const taskAssistantId = explicitTaskAssistantId ?? context.taskAssistantId;
  if (!taskAssistantId) {
    throw new Error(
      `Tool ${context.toolName} is not running inside a task assistant context.`
    );
  }

  const definition = definitions.get(taskAssistantId)?.definition;
  if (!definition) {
    throw new Error(
      `No task assistant definition found with id "${taskAssistantId}".`
    );
  }

  return definition;
}

function buildTaskAssistantResultFromOptions(
  options: TaskAssistantCompletionOptions
): TaskAssistantResult {
  const definition = requireTaskAssistantDefinitionForContext(
    options.context,
    options.taskAssistantId
  );

  return {
    taskAssistantId: definition.id,
    taskAssistantName: definition.name,
    conversationType: definition.conversationType,
    status: options.status ?? 'completed',
    summary: options.summary,
    handbackMessage: options.handbackMessage,
    outputText: options.outputText,
    outputArtifacts: options.outputArtifacts,
    pluginMetadata: options.pluginMetadata,
  };
}

async function appendSeedMessages(
  instance: ActiveTaskAssistantInstance,
  options: TaskAssistantToolHandoffOptions
): Promise<void> {
  if (options.contextHints) {
    await instance.conversation.appendExternalMessage({
      role: 'system',
      content: `Context for this task assistant session: ${options.contextHints}`,
    });
  }

  for (const message of options.initialMessages ?? []) {
    await instance.conversation.appendExternalMessage(message);
  }

  if (options.kickoffMessage) {
    await instance.conversation.appendExternalMessage({
      role: 'assistant',
      content: options.kickoffMessage,
    });
  }
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const definitions = new Map<
  string,
  { definition: TaskAssistantDefinition; pluginId: string }
>();
const activeInstances = new Map<number, ActiveTaskAssistantInstance>(); // keyed by session id
const completedResults = new Map<number, TaskAssistantResult>(); // keyed by session id; populated on completion/cancel
const TASK_ASSISTANT_LOG_PREFIX = '[TaskAssistants]';

function logTaskAssistantLifecycle(
  event: string,
  details?: Record<string, unknown>
): void {
  if (details) {
    systemLogger.log(`${TASK_ASSISTANT_LOG_PREFIX} ${event}`, details);
    return;
  }
  systemLogger.log(`${TASK_ASSISTANT_LOG_PREFIX} ${event}`);
}

function getElapsedMilliseconds(instance: ActiveTaskAssistantInstance): number {
  return Date.now() - instance.startedAt.getTime();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function formatTaskAssistantToolResult(
  result: TaskAssistantResult
): string {
  const lines: string[] = [
    `Task assistant: ${result.taskAssistantName}`,
    `Status: ${result.status}`,
    `Summary: ${result.summary}`,
    `Handback: ${result.handbackMessage}`,
  ];
  if (result.outputText) {
    lines.push(`Output:\n${result.outputText}`);
  }
  if (result.outputArtifacts && result.outputArtifacts.length > 0) {
    lines.push(`Saved files: ${result.outputArtifacts.join(', ')}`);
  }
  return lines.join('\n');
}

function getOptionalToolPrompt<
  T extends Tool['toolResultPromptIntro'] | Tool['toolResultPromptOutro'],
>(prompt: T | undefined): T {
  return (prompt ?? '') as T;
}

/**
 * Factory function that generates a standardized start and completion tool pair for a task assistant.
 *
 * This is the **recommended pattern** for plugins that want to spawn focused sub-conversations.
 * The factory handles all orchestration details (suspension, handoff detection, result building)
 * so plugin authors only need to provide two small callbacks: `buildHandoff()` and `buildCompletion()`.
 *
 * **Control Flow:**
 * 1. User invokes the start tool
 * 2. Start tool calls `buildHandoff()` to prepare contextHints and kickoffMessage
 * 3. Framework spawns a task-assistant conversation and suspends the parent tool call
 * 4. User interacts with the task-assistant conversation
 * 5. User invokes the completion tool (detected by framework context inference)
 * 6. Completion tool calls `buildCompletion()` to extract results and build handback message
 * 7. Parent tool call resumes and returns the completion result
 *
 * @param options Configuration object with two nested sections.
 *   @param options.start.definitionId Unique identifier for this task assistant (used for routing and context inference)
 *   @param options.start.name Tool function name (e.g., 'startBrainstormSession')
 *   @param options.start.availableFor Which conversation types can invoke this (e.g., ['chat', 'voice'])
 *   @param options.start.description Human-readable tool description for the LLM
 *   @param options.start.parameters Typebox schema defining input arguments
 *   @param options.start.systemPromptFragment Injected into system prompt during registration
 *   @param options.start.buildHandoff Async callback that receives parsed args and returns { contextHints?, kickoffMessage }
 *   @param options.start.formatResult Optional formatter for the tool result (default: pretty-print default format)
 *   @param options.complete.name Completion tool function name (e.g., 'completeBrainstormSession')
 *   @param options.complete.description Human-readable description for the completion tool
 *   @param options.complete.parameters Typebox schema for completion arguments
 *   @param options.complete.systemPromptFragment Injected into system prompt during registration
 *   @param options.complete.buildCompletion Async callback that receives parsed args and returns { summary, handbackMessage, outputText?, outputArtifacts? }
 *   @param options.complete.formatResult Optional formatter for the tool result (default: handbackMessage)
 *
 * @returns Object with `startTool` and `completionTool` properties, ready to pass to `plugin.registerTool()`
 *
 * @example
 * // In your plugin's registerPlugin() function:
 * const tools = createTaskAssistantToolPair({
 *   start: {
 *     definitionId: 'my-brainstorm',
 *     name: 'startBrainstormSession',
 *     availableFor: ['chat', 'voice'],
 *     description: 'Start a brainstorm session to generate creative ideas',
 *     parameters: Type.Object({
 *       topic: Type.String({ description: 'Topic to brainstorm about' }),
 *       duration: Type.Optional(Type.Number({ description: 'Estimated seconds (default 300)' })),
 *     }),
 *     systemPromptFragment: 'You are a creative brainstorming facilitator.',
 *     buildHandoff: async (args) => ({
 *       contextHints: [`Topic: ${args.topic}`, `Duration: ${args.duration ?? 300}s`],
 *       kickoffMessage: `Let's brainstorm about "${args.topic}". I'll generate ideas; you can refine them.`,
 *     }),
 *   },
 *   complete: {
 *     name: 'completeBrainstormSession',
 *     description: 'Finalize the brainstorm and save ideas',
 *     parameters: Type.Object({
 *       filename: Type.String({ description: 'Filename to save ideas to' }),
 *     }),
 *     systemPromptFragment: 'Summarize the best ideas from the brainstorm.',
 *     buildCompletion: async (args) => {
 *       const conversation = TaskAssistants.getActiveInstance(sessionId)?.conversation;
 *       const summary = conversation?.messages.map(m => m.content).join('\n') ?? 'No ideas generated';
 *       await saveToFile(args.filename, summary);
 *       return {
 *         summary,
 *         handbackMessage: `Ideas saved to ${args.filename}`,
 *         outputArtifacts: [args.filename],
 *       };
 *     },
 *   },
 * });
 *
 * plugin.registerTool(tools.startTool);
 * plugin.registerTool(tools.completionTool);
 */
export function createTaskAssistantToolPair(
  options: TaskAssistantToolPairFactoryOptions
): {
  startTool: Tool;
  completionTool: Tool;
} {
  return {
    startTool: {
      name: options.start.name,
      availableFor: options.start.availableFor,
      description: options.start.description,
      parameters: options.start.parameters,
      systemPromptFragment: options.start.systemPromptFragment,
      toolResultPromptIntro: getOptionalToolPrompt(
        options.start.toolResultPromptIntro
      ),
      toolResultPromptOutro: getOptionalToolPrompt(
        options.start.toolResultPromptOutro
      ),
      execute: async (args, context) => {
        return await TaskAssistants.runForToolCall({
          definitionId: options.start.definitionId,
          context,
          ...(await options.start.buildHandoff(args, context)),
        });
      },
    },
    completionTool: {
      name: options.complete.name,
      availableFor: [options.start.definitionId],
      description: options.complete.description,
      parameters: options.complete.parameters,
      systemPromptFragment: options.complete.systemPromptFragment,
      toolResultPromptIntro: getOptionalToolPrompt(
        options.complete.toolResultPromptIntro
      ),
      toolResultPromptOutro: getOptionalToolPrompt(
        options.complete.toolResultPromptOutro
      ),
      execute: async (args, context) => {
        const result = await TaskAssistants.completeForToolCall({
          context,
          ...(await options.complete.buildCompletion(args, context)),
        });

        return (
          options.complete.formatResult?.(result) ?? result.handbackMessage
        );
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Event wiring surface (consumed by plugin-hooks.ts to avoid import cycles)
// ---------------------------------------------------------------------------

type TaskAssistantBeginCallback = (
  instance: ActiveTaskAssistantInstance
) => Promise<void>;
type TaskAssistantEndCallback = (
  instance: ActiveTaskAssistantInstance,
  result: TaskAssistantResult
) => Promise<void>;

const onBeginCallbacks: TaskAssistantBeginCallback[] = [];
const onEndCallbacks: TaskAssistantEndCallback[] = [];

/**
 * @internal Used by plugin-hooks.ts to wire plugin hook dispatch.
 * Not part of the public plugin API.
 */
export const TaskAssistantEvents = {
  onBegin(callback: TaskAssistantBeginCallback): void {
    onBeginCallbacks.push(callback);
  },
  onEnd(callback: TaskAssistantEndCallback): void {
    onEndCallbacks.push(callback);
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const TaskAssistants = {
  /**
   * @internal Called by the plugin engine when a plugin calls registerTaskAssistant.
   */
  registerDefinition(
    pluginId: string,
    definition: TaskAssistantDefinition
  ): void {
    if (definitions.has(definition.id)) {
      const existing = definitions.get(definition.id)!;
      throw new Error(
        `Plugin ${pluginId} attempted to register a task assistant with id "${definition.id}", ` +
          `but that id is already registered by plugin ${existing.pluginId}. ` +
          `Disable one of these plugins to fix your assistant.`
      );
    }
    definitions.set(definition.id, { definition, pluginId });
    logTaskAssistantLifecycle('definition registered', {
      pluginId,
      taskAssistantId: definition.id,
      conversationType: definition.conversationType,
    });
  },

  getDefinition(id: string): TaskAssistantDefinition | undefined {
    return definitions.get(id)?.definition;
  },

  /**
   * Starts a task assistant for the given session. Fires the onTaskAssistantWillBegin hooks.
   *
   * @throws if the definition id is not registered, or the session already has an active instance.
   */
  async start(options: {
    definitionId: string;
    sessionId: number;
    entryMode: TaskAssistantEntryMode;
  }): Promise<ActiveTaskAssistantInstance> {
    const { definitionId, sessionId, entryMode } = options;
    logTaskAssistantLifecycle('start requested', {
      definitionId,
      sessionId,
      entryMode,
    });

    const entry = definitions.get(definitionId);
    if (!entry) {
      logTaskAssistantLifecycle('start failed: definition not found', {
        definitionId,
        sessionId,
      });
      throw new Error(
        `No task assistant definition found with id "${definitionId}". ` +
          `Make sure the plugin that provides this task assistant is enabled.`
      );
    }
    if (activeInstances.has(sessionId)) {
      logTaskAssistantLifecycle(
        'start failed: active instance already exists',
        {
          definitionId,
          sessionId,
        }
      );
      throw new Error(
        `Session ${sessionId} already has an active task assistant. ` +
          `Each session may only have one task assistant active at a time.`
      );
    }

    const { definition } = entry;
    const instance: ActiveTaskAssistantInstance = {
      instanceId: randomUUID(),
      definition,
      parentSessionId: sessionId,
      entryMode,
      conversation: startConversation(definition.conversationType, {
        sessionId,
        taskAssistantId: definition.id,
      }),
      startedAt: new Date(),
    };

    activeInstances.set(sessionId, instance);

    logTaskAssistantLifecycle('started', {
      sessionId,
      definitionId: definition.id,
      instanceId: instance.instanceId,
      entryMode,
      conversationType: definition.conversationType,
    });

    for (const callback of onBeginCallbacks) {
      await callback(instance);
    }

    logTaskAssistantLifecycle('begin hooks completed', {
      sessionId,
      instanceId: instance.instanceId,
      callbackCount: onBeginCallbacks.length,
    });

    return instance;
  },

  /** Returns the active task assistant instance for the given session, or undefined. */
  getActiveInstance(
    sessionId: number
  ): ActiveTaskAssistantInstance | undefined {
    return activeInstances.get(sessionId);
  },

  /**
   * Returns the result stored by the most recent `complete()` or `cancel()` call for the
   * given session, then removes it. Returns `undefined` if no result is waiting.
   *
   * Call this in the PATCH handler after the task assistant's `sendUserMessage()` resolves to
   * detect whether the task assistant just finished and to retrieve its handback payload.
   */
  getAndClearCompletedResult(
    sessionId: number
  ): TaskAssistantResult | undefined {
    const result = completedResults.get(sessionId);
    if (result) {
      completedResults.delete(sessionId);
    }
    return result;
  },

  /**
   * Starts a task assistant from within a tool call and optionally seeds it with initial
   * system or assistant messages.
   */
  async startForToolCall(
    options: TaskAssistantToolHandoffOptions
  ): Promise<ActiveTaskAssistantInstance> {
    const sessionId = requireToolContextSessionId(options.context);
    logTaskAssistantLifecycle('start for tool call requested', {
      sessionId,
      toolName: options.context.toolName,
      definitionId: options.definitionId,
      hasContextHints: !!options.contextHints,
      initialMessageCount: options.initialMessages?.length ?? 0,
      hasKickoffMessage: !!options.kickoffMessage,
    });

    const instance = await this.start({
      definitionId: options.definitionId,
      sessionId,
      entryMode: getEntryModeFromToolContext(options.context),
    });

    await appendSeedMessages(instance, options);
    logTaskAssistantLifecycle('seed messages appended', {
      sessionId,
      instanceId: instance.instanceId,
      hasContextHints: !!options.contextHints,
      initialMessageCount: options.initialMessages?.length ?? 0,
      hasKickoffMessage: !!options.kickoffMessage,
    });
    return instance;
  },

  /**
   * Starts a task assistant from a tool call and returns immediately, handing control of the
   * conversation over to the task assistant. The calling (parent) tool resolves right away so
   * the main assistant can make a brief transitional comment before the task assistant takes over.
   *
   * When the task assistant eventually calls its completion tool, the result is stored via
   * `getAndClearCompletedResult()` so the web-ui PATCH handler can retrieve it, inject the
   * handback message into the parent conversation, and let the main assistant wrap up.
   */
  async runForToolCall(
    options: TaskAssistantToolHandoffOptions
  ): Promise<string> {
    const instance = await this.startForToolCall(options);
    logTaskAssistantLifecycle('run for tool call: task assistant active', {
      sessionId: instance.parentSessionId,
      definitionId: instance.definition.id,
    });
    return `Task assistant "${instance.definition.name}" is now active and has taken over the conversation.`;
  },

  /**
   * Builds a normalized TaskAssistantResult using the current tool context.
   */
  buildResultForToolCall(
    options: TaskAssistantCompletionOptions
  ): TaskAssistantResult {
    return buildTaskAssistantResultFromOptions(options);
  },

  /**
   * Completes the current task assistant from within a completion tool and returns the
   * normalized result that was resolved back to the parent tool call.
   */
  async completeForToolCall(
    options: TaskAssistantCompletionOptions
  ): Promise<TaskAssistantResult> {
    const sessionId = requireToolContextSessionId(options.context);
    const result = buildTaskAssistantResultFromOptions(options);
    logTaskAssistantLifecycle('complete for tool call requested', {
      sessionId,
      toolName: options.context.toolName,
      taskAssistantId: result.taskAssistantId,
      status: result.status,
    });
    await this.complete(sessionId, result);
    return result;
  },

  /**
   * Same as completeForToolCall, but formats the normalized result as a tool-result string.
   */
  async completeForToolCallAndFormat(
    options: TaskAssistantCompletionOptions
  ): Promise<string> {
    const result = await this.completeForToolCall(options);
    return formatTaskAssistantToolResult(result);
  },

  /**
   * Marks the task assistant as complete. Removes the active instance, resolves the waiting
   * parent tool call result, and fires onTaskAssistantWillEnd hooks.
   */
  async complete(
    sessionId: number,
    result: TaskAssistantResult
  ): Promise<void> {
    const instance = activeInstances.get(sessionId);
    if (!instance) {
      logTaskAssistantLifecycle('complete ignored: no active instance', {
        sessionId,
        taskAssistantId: result.taskAssistantId,
        status: result.status,
      });
      return;
    }

    logTaskAssistantLifecycle('completing', {
      sessionId,
      instanceId: instance.instanceId,
      taskAssistantId: instance.definition.id,
      status: result.status,
      elapsedMs: getElapsedMilliseconds(instance),
    });

    activeInstances.delete(sessionId);
    completedResults.set(sessionId, result);

    for (const callback of onEndCallbacks) {
      await callback(instance, result);
    }

    logTaskAssistantLifecycle('completed', {
      sessionId,
      instanceId: instance.instanceId,
      taskAssistantId: instance.definition.id,
      status: result.status,
      elapsedMs: getElapsedMilliseconds(instance),
      callbackCount: onEndCallbacks.length,
    });
  },

  /**
   * Cancels the task assistant. Fires the onTaskAssistantWillEnd hooks with a 'cancelled' result.
   */
  async cancel(sessionId: number): Promise<void> {
    const instance = activeInstances.get(sessionId);
    if (!instance) {
      logTaskAssistantLifecycle('cancel ignored: no active instance', {
        sessionId,
      });
      return;
    }

    logTaskAssistantLifecycle('cancelling', {
      sessionId,
      instanceId: instance.instanceId,
      taskAssistantId: instance.definition.id,
      elapsedMs: getElapsedMilliseconds(instance),
    });

    activeInstances.delete(sessionId);

    const cancelResult: TaskAssistantResult = {
      taskAssistantId: instance.definition.id,
      taskAssistantName: instance.definition.name,
      conversationType: instance.definition.conversationType,
      status: 'cancelled',
      summary: 'Task assistant was cancelled.',
      handbackMessage: 'The task assistant session was cancelled.',
    };
    completedResults.set(sessionId, cancelResult);

    for (const callback of onEndCallbacks) {
      await callback(instance, cancelResult);
    }

    logTaskAssistantLifecycle('cancelled', {
      sessionId,
      instanceId: instance.instanceId,
      taskAssistantId: instance.definition.id,
      elapsedMs: getElapsedMilliseconds(instance),
      callbackCount: onEndCallbacks.length,
    });
  },
};
