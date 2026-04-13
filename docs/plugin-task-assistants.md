# Task Assistants

Task assistants are focused sub-conversations that run within a parent session. They're useful for implementing multi-step workflows like brainstorming, research, or guided interactions that need their own conversation context but hand results back to the main assistant.

> **Source of truth:** `src/lib/task-assistant.ts`

---

## Concept

A task assistant is a short-lived conversation that:

1. Gets spawned by a tool call from the main assistant
2. Runs its own conversation with its own system prompt and tool set
3. Completes (or is cancelled) and returns a result to the main assistant
4. The main assistant then incorporates the result into its response

This is different from a regular tool call — task assistants have their own full conversation context, can use tools, and produce structured results.

---

## `TaskAssistantDefinition`

Every task assistant must be registered with a definition:

```typescript
type TaskAssistantDefinition = {
  /** Unique identifier. Conventionally matches the plugin id. */
  id: string;
  /** Human-readable name shown in chat message labels. */
  name: string;
  /** The conversation type used for this task assistant's Conversation instance. */
  conversationType: ConversationTypeId;
};
```

Register via:

```typescript
plugin.registerTaskAssistant({
  id: 'my-task-assistant',
  name: 'My Task Assistant',
  conversationType: 'chat',
});
```

---

## `createTaskAssistantToolPair` — The Recommended Pattern

Rather than manually managing task assistant lifecycle, use the `createTaskAssistantToolPair` factory. It creates a matched pair of tools: a **start tool** that spawns the task assistant, and a **completion tool** that the task assistant calls to return its result.

```typescript
import { createTaskAssistantToolPair } from '../lib/task-assistant.js';

const { startTool, completionTool } = createTaskAssistantToolPair({
  start: {
    definitionId: 'my-task-assistant',
    name: 'startMyTask',
    availableFor: ['chat', 'voice'],
    description: 'Starts a focused task session.',
    parameters: Type.Object({
      topic: Type.String({ description: 'The topic to focus on' }),
    }),
    systemPromptFragment: 'You are a focused task assistant.',
    buildHandoff: (args, context) => ({
      contextHints: `The user wants to focus on: ${args.topic}`,
      kickoffMessage: `Let's focus on ${args.topic}.`,
    }),
  },
  complete: {
    name: 'completeMyTask',
    description: 'Completes the focused task session.',
    parameters: Type.Object({
      summary: Type.String({ description: 'Summary of what was accomplished' }),
    }),
    systemPromptFragment: 'You are completing a focused task.',
    buildCompletion: (args, context) => ({
      summary: args.summary as string,
      handbackMessage: `Task completed: ${args.summary}`,
    }),
  },
});

// Register both tools
plugin.registerTool(startTool);
plugin.registerTool(completionTool);
```

### `TaskAssistantToolPairFactoryOptions`

```typescript
type TaskAssistantToolPairFactoryOptions = {
  start: TaskAssistantStartToolFactoryOptions;
  complete: TaskAssistantCompletionToolFactoryOptions;
};
```

### Start Tool Options

```typescript
type TaskAssistantStartToolFactoryOptions = {
  /** Must match the TaskAssistantDefinition id. */
  definitionId: string;
  /** Tool name for the start tool. */
  name: string;
  /** Which conversation types this start tool is available in. */
  availableFor: ConversationTypeId[];
  /** Tool description shown to the LLM. */
  description: string;
  /** Typebox schema for the start tool's parameters. */
  parameters: TSchema;
  /** System prompt fragment for the start tool. */
  systemPromptFragment: Tool['systemPromptFragment'];
  /** Optional intro for tool result messages. */
  toolResultPromptIntro?: Tool['toolResultPromptIntro'];
  /** Optional outro for tool result messages. */
  toolResultPromptOutro?: Tool['toolResultPromptOutro'];
  /** Build the handoff options from the tool call arguments and context. */
  buildHandoff: (
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ) =>
    | Promise<Omit<TaskAssistantToolHandoffOptions, 'definitionId' | 'context'>>
    | Omit<TaskAssistantToolHandoffOptions, 'definitionId' | 'context'>;
  /** Optional custom result formatter. */
  formatResult?: (result: TaskAssistantResult) => string;
};
```

### Completion Tool Options

```typescript
type TaskAssistantCompletionToolFactoryOptions = {
  /** Tool name for the completion tool. */
  name: string;
  /** Tool description shown to the LLM. */
  description: string;
  /** Typebox schema for the completion tool's parameters. */
  parameters: TSchema;
  /** System prompt fragment for the completion tool. */
  systemPromptFragment: Tool['systemPromptFragment'];
  /** Optional intro for tool result messages. */
  toolResultPromptIntro?: Tool['toolResultPromptIntro'];
  /** Optional outro for tool result messages. */
  toolResultPromptOutro?: Tool['toolResultPromptOutro'];
  /** Build the completion options from the tool call arguments and context. */
  buildCompletion: (
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ) =>
    | Promise<Omit<TaskAssistantCompletionOptions, 'context'>>
    | Omit<TaskAssistantCompletionOptions, 'context'>;
  /** Optional custom result formatter. */
  formatResult?: (result: TaskAssistantResult) => string;
};
```

---

## Lifecycle

```
Main Assistant
  └─ Calls startTool(args)
       └─ Task Assistant begins
            ├─ New Conversation created
            ├─ Seed messages added (if any)
            ├─ onTaskAssistantWillBegin hook fires
            ├─ Task assistant runs its conversation
            ├─ Calls completionTool(args)
            │    └─ TaskAssistantResult created
            ├─ onTaskAssistantWillEnd hook fires
            └─ Result returned to main assistant
```

### `TaskAssistantToolHandoffOptions`

Options for starting a task assistant from a tool call:

```typescript
type TaskAssistantToolHandoffOptions = {
  definitionId: string;
  context: ToolExecutionContext;
  contextHints?: string;
  kickoffMessage?: string;
  initialMessages?: TaskAssistantSeedMessage[];
};
```

### `TaskAssistantSeedMessage`

```typescript
type TaskAssistantSeedMessage = Pick<Message, 'role' | 'content'>;
```

### `TaskAssistantCompletionOptions`

```typescript
type TaskAssistantCompletionOptions = {
  context: ToolExecutionContext;
  taskAssistantId?: string;
  status?: TaskAssistantStatus; // defaults to 'completed'
  summary: string;
  handbackMessage: string;
  outputText?: string;
  outputArtifacts?: string[];
  pluginMetadata?: Record<string, unknown>;
};
```

---

## `TaskAssistantResult`

The result produced when a task assistant completes:

```typescript
type TaskAssistantResult = {
  taskAssistantId: string;
  taskAssistantName: string;
  conversationType: ConversationTypeId;
  status: TaskAssistantStatus; // 'running' | 'completed' | 'cancelled' | 'error'
  summary: string;
  handbackMessage: string;
  outputText?: string;
  outputArtifacts?: string[];
  pluginMetadata?: Record<string, unknown>;
};
```

---

## Hooks

Task assistant hooks are available on the `hooks` object:

### `onTaskAssistantWillBegin(callback)`

Called after the task assistant's `Conversation` is created, before any user messages.

```typescript
hooks.onTaskAssistantWillBegin(async instance => {
  console.log(`Task assistant ${instance.definition.name} started`);
});
```

### `onTaskAssistantWillEnd(callback)`

Called when the task assistant session ends (completed or cancelled).

```typescript
hooks.onTaskAssistantWillEnd(async (instance, result) => {
  console.log(
    `Task assistant ${instance.definition.name} ended with status: ${result.status}`
  );
});
```

---

## Working Example: Brainstorm Plugin

The `brainstorm` plugin (`src/plugins/community/brainstorm/`) demonstrates a complete task assistant implementation:

1. Registers a conversation type: `brainstorm` (base type `chat`, no personality)
2. Registers a task assistant definition: `{ id: 'brainstorm', name: 'Brainstorm Assistant', conversationType: 'brainstorm' }`
3. Uses `createTaskAssistantToolPair` to create `startBrainstormSession` and `completeBrainstormSession` tools
4. Both tools are available for `chat` and `voice` conversation types

This is the recommended pattern for any plugin that needs a focused sub-conversation.
