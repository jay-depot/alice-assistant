# Plugin Types Reference

A comprehensive reference of all plugin-facing types in A.L.I.C.E. Assistant.

> **Source of truth:** The TypeScript source files referenced below. This document is a convenience copy — always verify against the source if behavior is unclear.

---

## Core Plugin Types

### `AlicePlugin`

_Source: `src/lib/types/alice-plugin-interface.ts`_

```typescript
type AlicePlugin = {
  pluginMetadata: AlicePluginMetadata;
  registerPlugin: (api: AlicePluginInterface) => Promise<void>;
};
```

### `AlicePluginMetadata`

_Source: `src/lib/types/alice-plugin-interface.ts`_

```typescript
type AlicePluginMetadata = {
  id: string;
  name: string;
  version: string;
  description: string;
  required?: boolean;
  builtInCategory?: 'system' | 'community';
  dependencies?: AlicePluginDependency[];
};
```

### `AlicePluginDependency`

_Source: `src/lib/types/alice-plugin-interface.ts`_

```typescript
type AlicePluginDependency = {
  id: string;
  version: string;
};
```

### `BuiltInPluginCategory`

_Source: `src/lib/types/alice-plugin-interface.ts`_

```typescript
type BuiltInPluginCategory = 'system' | 'community';
```

### `AlicePluginInterface`

_Source: `src/lib/types/alice-plugin-interface.ts`_

```typescript
type AlicePluginInterface = {
  registerPlugin: () => Promise<{
    registerTool: (toolDefinition: Tool) => void;
    registerHeaderSystemPrompt: (promptDefinition: DynamicPrompt) => void;
    registerFooterSystemPrompt: (promptDefinition: DynamicPrompt) => void;
    registerConversationType: (
      conversationTypeDefinition: ConversationTypeDefinition
    ) => void;
    registerTaskAssistant: (definition: TaskAssistantDefinition) => void;
    registerSessionLinkedAgent: (definition: SessionLinkedAgentDefinition) => {
      autoStartTool: Tool;
    };
    addToolToConversationType: (
      conversationTypeId: ConversationTypeId,
      pluginId: string,
      toolName: string
    ) => void;
    hooks: AlicePluginHooks;
    config: <T extends Record<string, unknown>>(
      validationSchema: TSchema,
      defaultConfig: T
    ) => Promise<{
      getPluginConfig: () => T;
      getSystemConfig(): SystemConfigFull;
    }>;
    offer: <T extends keyof PluginCapabilities>(
      capabilities: PluginCapabilities[T]
    ) => void;
    request: <T extends keyof PluginCapabilities>(
      pluginName: T
    ) => PluginCapabilities[T] | undefined;
  }>;
};
```

### `PluginCapabilities`

_Source: `src/lib/types/alice-plugin-interface.ts`_

Extensible via module augmentation. Base interface is empty:

```typescript
declare module './alice-plugin-interface.js' {
  export interface PluginCapabilities {}
}
```

Plugins augment it:

```typescript
declare module '@/lib/types/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'my-plugin': { myMethod(): void };
  }
}
```

---

## Tool Types

### `Tool`

_Source: `src/lib/tool-system.ts`_

```typescript
type Tool = {
  name: string;
  availableFor: ConversationTypeId[];
  description: string;
  systemPromptFragment: ToolPromptFragmentFunction;
  parameters: TSchema;
  toolResultPromptIntro: ToolPromptFragmentFunction;
  toolResultPromptOutro: ToolPromptFragmentFunction;
  execute: (
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ) => Promise<string>;
};
```

### `ToolExecutionContext`

_Source: `src/lib/tool-system.ts`_

```typescript
type ToolExecutionContext = {
  toolName: string;
  conversationType: DynamicPromptConversationType;
  sessionId?: number;
  taskAssistantId?: string;
  agentInstanceId?: string;
};
```

### `ToolPromptFragmentFunction`

_Source: `src/lib/tool-system.ts`_

```typescript
type ToolPromptFragmentFunction =
  | string
  | ((type: DynamicPromptConversationType) => string);
```

---

## Dynamic Prompt Types

### `DynamicPrompt`

_Source: `src/lib/dynamic-prompt.ts`_

```typescript
type DynamicPrompt = {
  weight: number;
  name: string;
  getPrompt: (
    context: DynamicPromptContext
  ) => Promise<string | false> | string | false;
};
```

### `DynamicPromptContext`

_Source: `src/lib/dynamic-prompt.ts`_

```typescript
type DynamicPromptContext = {
  conversationType: DynamicPromptConversationType;
  sessionId?: number;
  toolCallsAllowed?: boolean;
  taskAssistantId?: string;
};
```

### `DynamicPromptConversationType`

_Source: `src/lib/dynamic-prompt.ts`_

```typescript
type DynamicPromptConversationType = ConversationTypeId;
```

---

## Conversation Types

### `ConversationTypeDefinition`

_Source: `src/lib/conversation-types.ts`_

```typescript
type ConversationTypeDefinition = {
  id: ConversationTypeId;
  name: string;
  description: string;
  baseType: ConversationTypeFamily;
  includePersonality?: boolean;
  scenarioPrompt?: string;
  maxToolCallDepth?: number;
};
```

### `ConversationTypeId`

_Source: `src/lib/conversation-types.ts`_

```typescript
const BUILT_IN_CONVERSATION_TYPE_IDS = [
  'voice',
  'chat',
  'startup',
  'autonomy',
] as const;
type BuiltInConversationTypeId =
  (typeof BUILT_IN_CONVERSATION_TYPE_IDS)[number];
type ConversationTypeId = BuiltInConversationTypeId | (string & {});
```

### `ConversationTypeFamily`

_Source: `src/lib/conversation-types.ts`_

```typescript
type ConversationTypeFamily = BuiltInConversationTypeId;
```

---

## Task Assistant Types

### `TaskAssistantDefinition`

_Source: `src/lib/task-assistant.ts`_

```typescript
type TaskAssistantDefinition = {
  id: string;
  name: string;
  conversationType: ConversationTypeId;
};
```

### `TaskAssistantResult`

_Source: `src/lib/task-assistant.ts`_

```typescript
type TaskAssistantResult = {
  taskAssistantId: string;
  taskAssistantName: string;
  conversationType: ConversationTypeId;
  status: TaskAssistantStatus;
  summary: string;
  handbackMessage: string;
  outputText?: string;
  outputArtifacts?: string[];
  pluginMetadata?: Record<string, unknown>;
};
```

### `TaskAssistantStatus`

_Source: `src/lib/task-assistant.ts`_

```typescript
type TaskAssistantStatus = 'running' | 'completed' | 'cancelled' | 'error';
```

### `TaskAssistantEntryMode`

_Source: `src/lib/task-assistant.ts`_

```typescript
type TaskAssistantEntryMode = 'chat' | 'voice';
```

### `ActiveTaskAssistantInstance`

_Source: `src/lib/task-assistant.ts`_

```typescript
type ActiveTaskAssistantInstance = {
  instanceId: string;
  definition: TaskAssistantDefinition;
  parentSessionId: number;
  entryMode: TaskAssistantEntryMode;
  conversation: Conversation;
  startedAt: Date;
};
```

### `TaskAssistantSeedMessage`

_Source: `src/lib/task-assistant.ts`_

```typescript
type TaskAssistantSeedMessage = Pick<Message, 'role' | 'content'>;
```

### `TaskAssistantToolHandoffOptions`

_Source: `src/lib/task-assistant.ts`_

```typescript
type TaskAssistantToolHandoffOptions = {
  definitionId: string;
  context: ToolExecutionContext;
  contextHints?: string;
  kickoffMessage?: string;
  initialMessages?: TaskAssistantSeedMessage[];
};
```

### `TaskAssistantCompletionOptions`

_Source: `src/lib/task-assistant.ts`_

```typescript
type TaskAssistantCompletionOptions = {
  context: ToolExecutionContext;
  taskAssistantId?: string;
  status?: TaskAssistantStatus;
  summary: string;
  handbackMessage: string;
  outputText?: string;
  outputArtifacts?: string[];
  pluginMetadata?: Record<string, unknown>;
};
```

### `TaskAssistantToolPairFactoryOptions`

_Source: `src/lib/task-assistant.ts`_

```typescript
type TaskAssistantToolPairFactoryOptions = {
  start: TaskAssistantStartToolFactoryOptions;
  complete: TaskAssistantCompletionToolFactoryOptions;
};

type TaskAssistantStartToolFactoryOptions = {
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
  formatResult?: (result: TaskAssistantResult) => string;
};

type TaskAssistantCompletionToolFactoryOptions = {
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
```

---

## Session-Linked Agent Types

### `SessionLinkedAgentDefinition`

_Source: `src/lib/agent-system.ts`_

```typescript
type SessionLinkedAgentDefinition = {
  id: string;
  name: string;
  conversationType: ConversationTypeId;
  maxIterations?: number;
  continuationPrompt?: string;
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

### `SessionLinkedAgentStatus`

_Source: `src/lib/agent-system.ts`_

```typescript
type SessionLinkedAgentStatus =
  | 'running'
  | 'cancelled'
  | 'erroring'
  | 'completed';
```

### `SessionLinkedAgentInstance`

_Source: `src/lib/agent-system.ts`_

```typescript
type SessionLinkedAgentInstance = {
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
```

### `SessionLinkedAgentUpdate`

_Source: `src/lib/agent-system.ts`_

```typescript
type SessionLinkedAgentUpdate = {
  linkedSessionId: number;
  agentInstanceId: string;
  agentName: string;
  kind: 'progress' | 'result';
  heading: string;
  content: string;
};
```

### `SessionLinkedAgentResult`

_Source: `src/lib/agent-system.ts`_

```typescript
type SessionLinkedAgentResult = {
  summary: string;
  report: string;
};
```

### `PendingAgentMessage`

_Source: `src/lib/agent-system.ts`_

```typescript
type PendingAgentMessage = {
  heading: string;
  content: string;
};
```

---

## Personality Types

### `PersonalityProvider`

_Source: `src/lib/personality-system.ts`_

```typescript
type PersonalityProvider = {
  renderPrompt: (context: PersonalityRenderContext) => Promise<string> | string;
};
```

### `PersonalityRenderContext`

_Source: `src/lib/personality-system.ts`_

```typescript
type PersonalityRenderContext = {
  purpose: PersonalityRenderPurpose;
  conversationType?: ConversationTypeId;
  sessionId?: number;
};
```

### `PersonalityRenderPurpose`

_Source: `src/lib/personality-system.ts`_

```typescript
type PersonalityRenderPurpose = 'conversation-header' | 'notification';
```

---

## Configuration Types

### `SystemConfigBasic`

_Source: `src/lib/types/system-config-basic.ts`_

```typescript
type SystemConfigBasic = {
  wakeWord: string;
  assistantName: string;
  location: string;
  webInterface: {
    enabled: boolean;
    port: number;
    bindToAddress: string;
  };
  ollama: {
    host: string;
    model: string;
    options?: {
      think?: boolean | string;
      num_ctx?: number;
      top_p?: number;
      min_p?: number;
      top_k?: number;
      temperature?: number;
    };
  };
  piperTts: {
    host: string;
    model: string;
    speaker: number;
  };
  openWakeWord: {
    model: string;
  };
};
```

### `SystemConfigFull`

_Source: `src/lib/types/system-config-full.ts`_

```typescript
type SystemConfigFull = SystemConfigBasic & {
  configDirectory: string;
};
```

---

## Web UI Types

### `UIRegion`

_Source: `src/lib/types/alice-plugin-interface.ts`_

```typescript
type UIRegion =
  | 'sidebar-top'
  | 'sidebar-bottom'
  | 'chat-header'
  | 'message-prefix'
  | 'message-suffix'
  | 'input-prefix'
  | 'settings-panel';
```

### `AliceUiScriptRegistration`

_Source: `src/lib/types/alice-plugin-interface.ts`_

```typescript
type AliceUiScriptRegistration = {
  id: string;
  scriptUrl?: string;
  styleUrls: string[];
};
```

### `PluginClientExport`

_Source: `src/plugins/system/web-ui/client/types/index.ts`_

```typescript
interface PluginClientExport {
  regions?: Partial<Record<UIRegion, ComponentType>>;
  routes?: PluginClientRoute[];
  onAliceUIReady?: (api: AliceUIExtensionApi) => void | Promise<void>;
}
```

### `AliceUIExtensionApi`

_Source: `src/plugins/system/web-ui/client/types/index.ts`_

```typescript
interface AliceUIExtensionApi {
  registerComponent: (region: UIRegion, component: ComponentType) => void;
  registerRoute: (route: PluginClientRoute) => void;
}
```

### `PluginClientRoute`

_Source: `src/plugins/system/web-ui/client/types/index.ts`_

```typescript
interface PluginClientRoute extends ExtensionRouteDefinition {
  component: ComponentType;
}

interface ExtensionRouteDefinition {
  path: string;
  title?: string;
}
```

---

## Conversation Types

### `Message`

_Source: `src/lib/conversation.ts`_

```typescript
type Message = {
  role: string;
  content: string;
  tool_calls?: ToolCall[];
};
```

### `StartConversationOptions`

_Source: `src/lib/conversation.ts`_

```typescript
type StartConversationOptions = {
  sessionId?: number;
  taskAssistantId?: string;
  agentInstanceId?: string;
};
```

---

## Hook Types

### `AlicePluginHooks`

_Source: `src/lib/types/alice-plugin-hooks.ts`_

See [Plugin Hooks Reference](./plugin-hooks.md) for the full type signatures and registration windows.
