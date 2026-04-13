# Plugin API Reference

This document covers the core plugin interface — the shape of a plugin, the registration flow, and every method available on the `registerPlugin()` return object.

> **Source of truth:** `src/lib/types/alice-plugin-interface.ts`, `src/lib/alice-plugin-engine.ts`

---

## Plugin Shape

Every A.L.I.C.E. plugin is an object conforming to the `AlicePlugin` type:

```typescript
type AlicePlugin = {
  pluginMetadata: AlicePluginMetadata;
  registerPlugin: (api: AlicePluginInterface) => Promise<void>;
};
```

### `AlicePluginMetadata`

```typescript
type AlicePluginMetadata = {
  /** Unique identifier. Conventionally the package name. */
  id: string;
  /** Human-friendly name for UI and error messages. Should be unique. */
  name: string;
  /**
   * Semver version string. Built-in shipped plugins may use the magic
   * string "LATEST" to always match the assistant's version.
   * External user plugins may NOT use "LATEST".
   */
  version: string;
  /** Short description of what the plugin does. */
  description: string;
  /**
   * Whether this plugin is required for the assistant to function.
   * Assigned authoritatively from the built-in registry during loading.
   * External user plugins may NOT set this.
   */
  required?: boolean;
  /**
   * The category of built-in plugin. Assigned authoritatively from the
   * built-in registry. Actual category used by core.
   * External user plugins may NOT set this.
   */
  builtInCategory?: 'system' | 'community';
  /**
   * Plugins that must be loaded before this one. If any dependency is
   * missing or fails to load, the assistant will not start.
   */
  dependencies?: AlicePluginDependency[];
};
```

### `AlicePluginDependency`

```typescript
type AlicePluginDependency = {
  /** The plugin id to depend on. */
  id: string;
  /** Semver range string (e.g., "^1.0.0" or "LATEST"). */
  version: string;
};
```

---

## Registration Flow

1. The plugin loader reads `~/.alice-assistant/plugin-settings/enabled-plugins.json` and resolves each enabled plugin.
2. Each plugin module is dynamically imported. Its `default` export must be an `AlicePlugin`.
3. Built-in plugins have their `required` and `builtInCategory` fields assigned from `src/plugins/system-plugins.json`.
4. The engine validates: no duplicate IDs, no missing dependencies, no dependency cycles, no user plugins setting `required`/`builtInCategory`/`LATEST` version.
5. Each plugin's `registerPlugin(api)` is called with an `AlicePluginInterface`.
6. Inside `registerPlugin`, the plugin calls `await pluginInterface.registerPlugin()` to receive the scoped API object.
7. The plugin registers tools, prompts, conversation types, etc. on the returned object.
8. After all plugins' `registerPlugin` callbacks resolve, the engine **closes registration** — no more `registerTool`, `registerHeaderSystemPrompt`, etc. calls are allowed.
9. Pending conversation-type tool links are validated and applied.
10. The `onAllPluginsLoaded` lifecycle hook fires.

### Two-Phase Model

| Phase                                               | What's allowed                                                                                                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registration** (inside `registerPlugin` callback) | `registerTool`, `registerHeaderSystemPrompt`, `registerFooterSystemPrompt`, `registerConversationType`, `registerTaskAssistant`, `registerSessionLinkedAgent`, `addToolToConversationType`, `config`, `offer`, `request`, hook registration |
| **Post-registration** (after `onAllPluginsLoaded`)  | Hook callbacks, tool execution, offered API calls, conversation events                                                                                                                                                                      |

---

## `registerPlugin()` Return API

Calling `await pluginInterface.registerPlugin()` returns an object with the following methods:

### `registerTool(toolDefinition)`

Registers an LLM-callable tool.

```typescript
registerTool(toolDefinition: Tool): void;
```

**`Tool` type:**

```typescript
type Tool = {
  /** Unique tool name. Throws on collision. */
  name: string;
  /** Which conversation types this tool is available in. */
  availableFor: ConversationTypeId[];
  /** Description shown to the LLM to decide when to call this tool. */
  description: string;
  /**
   * Prompt fragment injected into the system prompt when this tool is available.
   * Can be a static string or a function that receives the conversation type.
   * Usually blank.
   */
  systemPromptFragment: ToolPromptFragmentFunction;
  /** Typebox schema defining the tool's parameters. */
  parameters: TSchema;
  /**
   * Text prepended to the tool result in the conversation.
   * Can be a static string or a function that receives the conversation type.
   * Usually blank, but occasionally useful to explain your formatting to the LLM.
   */
  toolResultPromptIntro: ToolPromptFragmentFunction;
  /**
   * Text appended after the tool result in the conversation.
   * Can be a static string or a function that receives the conversation type.
   * Usually blank, but occasionally useful for reminders like "include links to sources".
   */
  toolResultPromptOutro: ToolPromptFragmentFunction;
  /**
   * The function that executes when the LLM calls this tool.
   * Whatever you return from this is sent back to the LLM (wrapped with your intro and
   * outro if provided), as a system message to provide the tool call result.
   */
  execute: (
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ) => Promise<string>;
};
```

**`ToolPromptFragmentFunction`:**

```typescript
type ToolPromptFragmentFunction =
  | string
  | ((type: DynamicPromptConversationType) => string);
```

**`ToolExecutionContext`:**

```typescript
type ToolExecutionContext = {
  toolName: string;
  conversationType: DynamicPromptConversationType;
  sessionId?: number;
  /** Set when the tool is called within a task assistant conversation. */
  taskAssistantId?: string;
  /** Set when the tool is called within a session-linked agent conversation. */
  agentInstanceId?: string;
};
```

---

### `registerHeaderSystemPrompt(promptDefinition)`

Injects prompt content **before** conversation turns (in the header section).

```typescript
registerHeaderSystemPrompt(promptDefinition: DynamicPrompt): void;
```

**`DynamicPrompt` type:**

```typescript
type DynamicPrompt = {
  /**
   * Sorting weight. Lower numbers are sent first. Same weight → sorted
   * alphabetically by name. Non-built-in plugins: weight must be 0–9999.
   */
  weight: number;
  /** Unique name for sorting and log labeling. Throws on duplicate name. */
  name: string;
  /**
   * Generate prompt text. Return or resolve to `false` to exclude
   * from the current context.
   */
  getPrompt: (
    context: DynamicPromptContext
  ) => Promise<string | false> | string | false;
};
```

**`DynamicPromptContext`:**

```typescript
type DynamicPromptContext = {
  conversationType: DynamicPromptConversationType;
  sessionId?: number;
  toolCallsAllowed?: boolean;
  /** Set when this context is for a task assistant conversation. */
  taskAssistantId?: string;
};
```

**Weight limits:** Non-built-in plugins must use weights in the range 0–9999. Built-in plugins have no upper limit.

---

### `registerFooterSystemPrompt(promptDefinition)`

Injects prompt content **after** conversation turns (in the footer section). Same `DynamicPrompt` type and weight limits as header prompts.

```typescript
registerFooterSystemPrompt(promptDefinition: DynamicPrompt): void;
```

---

### `registerConversationType(conversationTypeDefinition)`

Adds a new conversation type that tools and prompts can target.

```typescript
registerConversationType(conversationTypeDefinition: ConversationTypeDefinition): void;
```

**`ConversationTypeDefinition`:**

```typescript
type ConversationTypeDefinition = {
  /** Unique identifier for this conversation type. Throws on duplicate. */
  id: ConversationTypeId;
  /** Human-readable name. Must be non-empty. */
  name: string;
  /** Description. Must be non-empty. */
  description: string;
  /** Must be one of the built-in base types: 'voice', 'chat', 'startup', 'autonomy'. */
  baseType: ConversationTypeFamily;
  /** Whether to include personality prompts. Defaults to true. */
  includePersonality?: boolean;
  /** Optional scenario prompt injected for this conversation type. */
  scenarioPrompt?: string;
  /** Optional max tool call depth. Must be a positive integer if set. */
  maxToolCallDepth?: number;
};
```

**Built-in conversation type IDs:** `'voice'`, `'chat'`, `'startup'`, `'autonomy'`

**`ConversationTypeId`:** `BuiltInConversationTypeId | string` — you can create custom IDs that extend the built-in set.

**`ConversationTypeFamily`:** Alias for `BuiltInConversationTypeId` — every custom conversation type must declare one of the four built-in types as its `baseType`.

---

### `registerTaskAssistant(definition)`

Registers a task assistant definition for focused sub-conversations.

```typescript
registerTaskAssistant(definition: TaskAssistantDefinition): void;
```

**`TaskAssistantDefinition`:**

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

See [Task Assistants](./plugin-task-assistants.md) for the full lifecycle and the `createTaskAssistantToolPair` factory.

---

### `registerSessionLinkedAgent(definition)`

Registers a session-linked agent definition for autonomous multi-turn conversations.

```typescript
registerSessionLinkedAgent(
  definition: SessionLinkedAgentDefinition
): { autoStartTool: Tool };
```

Returns an `{ autoStartTool }` object containing a pre-built `Tool` that can be added to conversation types via `addToolToConversationType`.

**`SessionLinkedAgentDefinition`:**

```typescript
type SessionLinkedAgentDefinition = {
  id: string;
  name: string;
  conversationType: ConversationTypeId;
  /** Optional max synthetic user-turn iterations. Defaults to 8. */
  maxIterations?: number;
  /** Synthetic user prompt sent between autonomous agent turns. */
  continuationPrompt?: string;
  /** Synthetic user prompt sent when max iterations are reached. */
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
```

See [Session-Linked Agents](./plugin-agents.md) for the full guide.

---

### `addToolToConversationType(conversationTypeId, sourcePluginId, toolName)`

Attaches an existing tool to a conversation type. Only the conversation type's owning plugin can add tools to it.

```typescript
addToolToConversationType(
  conversationTypeId: ConversationTypeId,
  sourcePluginId: string,
  toolName: string
): void;
```

- `conversationTypeId` — The target conversation type.
- `sourcePluginId` — The plugin that registered the tool.
- `toolName` — The name of the tool to add.

Pending links are validated after all plugins load. Throws if the conversation type doesn't exist, the tool doesn't exist, or the calling plugin doesn't own the conversation type.

---

### `hooks`

Provides access to lifecycle and event hooks. See [Plugin Hooks](./plugin-hooks.md) for full documentation.

```typescript
hooks: AlicePluginHooks;
```

---

### `config(validationSchema, defaultConfig)`

Creates or loads a typed configuration file for the plugin.

```typescript
config: <T extends Record<string, unknown>>(
  validationSchema: TSchema,
  defaultConfig: T
) =>
  Promise<{
    getPluginConfig: () => T;
    getSystemConfig(): SystemConfigFull;
  }>;
```

- Config files are stored at `~/.alice-assistant/plugin-settings/<plugin-id>/<plugin-id>.json`.
- The `validationSchema` is a Typebox schema used to validate the config.
- If the file doesn't exist, it's created from `defaultConfig`.
- Returns `getPluginConfig()` (returns the validated config) and `getSystemConfig()` (returns the full system config including `configDirectory`).

**`SystemConfigFull`:**

```typescript
type SystemConfigFull = SystemConfigBasic & {
  configDirectory: string;
};
```

Where `SystemConfigBasic` includes: `wakeWord`, `assistantName`, `location`, `webInterface` (`enabled`, `port`, `bindToAddress`), `ollama` (`host`, `model`, `options`), `piperTts` (`host`, `model`, `speaker`), `openWakeWord` (`model`).

---

### `offer(capabilities)`

Exposes an API to plugins that declare a dependency on this plugin.

```typescript
offer: <T extends keyof PluginCapabilities>(capabilities: PluginCapabilities[T]) => void;
```

**Rules:**

- May only be called **once** per plugin.
- May only be called **during registration** (inside the `registerPlugin` callback).
- Throws with a descriptive error naming the offending plugin if violated.

**TypeScript augmentation pattern:**

```typescript
declare module '@/lib/types/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'my-plugin-id': {
      myMethod(): void;
      myProperty: string;
    };
  }
}
```

See [Offered APIs](./plugin-offered-apis.md) for all system plugin offered APIs.

---

### `request(pluginName)`

Retrieves the offered API of a dependency.

```typescript
request: <T extends keyof PluginCapabilities>(pluginName: T) =>
  PluginCapabilities[T] | undefined;
```

**Rules:**

- May only request plugins declared in `dependencies`.
- Returns `undefined` if the dependency doesn't offer any API.
- Throws if called for a non-dependency.

**Usage:**

```typescript
const memory = plugin.request('memory');
if (memory) {
  await memory.saveMemory('some content');
}
```
