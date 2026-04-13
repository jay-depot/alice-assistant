# Plugin Hooks Reference

Hooks let plugins react to lifecycle events and conversation activity. They are accessed via the `hooks` property on the object returned by `registerPlugin()`.

> **Source of truth:** `src/lib/types/alice-plugin-hooks.ts`, `src/lib/plugin-hooks.ts`

---

## Registration Windows

Each hook has a **registration window** — the period during which callbacks can be registered. Attempting to register a callback after the hook's invocation has occurred throws an error naming the offending plugin.

The registration windows form a chain:

```
Plugin registration
  └─► onAllPluginsLoaded
       └─► onAssistantWillAcceptRequests
            └─► onAssistantAcceptsRequests
                 └─► onAssistantWillStopAcceptingRequests
                      └─► onAssistantStoppedAcceptingRequests
                           └─► onPluginsWillUnload
```

---

## Lifecycle Hooks

Lifecycle hooks fire once during the assistant's startup and shutdown sequence.

### `onAllPluginsLoaded(callback)`

The earliest lifecycle event. Called after all plugins have been loaded and their `registerPlugin` callbacks have resolved.

**Registration window:** During plugin registration only.

**Callback signature:**

```typescript
() => Promise<void>;
```

**Typical uses:**

- Initializing databases (the `memory` plugin does this)
- Validating that required providers are registered
- Performing one-time setup that depends on other plugins being available

---

### `onAssistantWillAcceptRequests(callback)`

Called when the assistant is about to start accepting requests. Fires immediately after all `onAllPluginsLoaded` callbacks have finished.

**Registration window:** During plugin registration or inside an `onAllPluginsLoaded` callback.

**Callback signature:**

```typescript
() => Promise<void>;
```

**Typical uses:**

- Generating access tokens (the `voice` plugin does this)
- Final pre-flight checks before going live

---

### `onAssistantAcceptsRequests(callback)`

Called when the assistant is live and accepting requests. Fires immediately after `onAssistantWillAcceptRequests` callbacks finish.

**Registration window:** During plugin registration, `onAllPluginsLoaded`, or `onAssistantWillAcceptRequests`.

**Callback signature:**

```typescript
() => Promise<void>;
```

**Typical uses:**

- Starting HTTP servers (the `rest-serve` and `web-ui` plugins do this)
- Beginning background processes like polling loops (the `reminders-broker` does this)

---

### `onAssistantWillStopAcceptingRequests(callback)`

Called when a shutdown signal is received. The assistant is no longer accepting new requests.

**Registration window:** Through `onAssistantAcceptsRequests`.

**Callback signature:**

```typescript
() => Promise<void>;
```

**Typical uses:**

- Stopping HTTP servers
- Performing a final poll cycle (the `reminders-broker` does this)

---

### `onAssistantStoppedAcceptingRequests(callback)`

Called after all pending requests have been handled and the assistant has fully stopped accepting requests.

**Registration window:** Through `onAssistantWillStopAcceptingRequests`.

**Callback signature:**

```typescript
() => Promise<void>;
```

---

### `onPluginsWillUnload(callback)`

The last lifecycle event. Called right before plugins are unloaded and the process exits.

**Registration window:** Through `onAssistantStoppedAcceptingRequests`.

**Callback signature:**

```typescript
() => Promise<void>;
```

**Typical uses:**

- Closing database connections (the `memory` plugin does this)
- Final cleanup

---

## Event Hooks

Event hooks fire in response to conversation activity. They allow late registration (until the first time they are invoked).

### `onUserConversationWillBegin(callback)`

Called before the first real user turn in a conversation. **Not** called for the startup test conversation.

**Registration window:** Until the first conversation begins. Practically, register during plugin registration or `onAllPluginsLoaded`.

**Callback signature:**

```typescript
(conversation: Conversation, type: DynamicPromptConversationType) =>
  Promise<void>;
```

**Parameters:**

- `conversation` — The `Conversation` object for the new session. See [Conversation type](./plugin-types-reference.md#conversation) for available methods.
- `type` — The conversation type ID (e.g., `'chat'`, `'voice'`).

---

### `onUserConversationWillEnd(callback)`

Called when a user clicks "end conversation" in the web UI, or when a voice conversation times out. **Not** called for the startup test conversation.

**Registration window:** Until the first conversation ends.

**Callback signature:**

```typescript
(conversation: Conversation, type: DynamicPromptConversationType) =>
  Promise<void>;
```

---

### `onContextCompactionSummariesWillBeDeleted(callback)`

Called when a conversation's context has grown too long and the oldest compaction summaries are about to be discarded.

**Registration window:** Until the first compaction event.

**Callback signature:**

```typescript
(summaries: Message[]) => Promise<void>;
```

**Parameters:**

- `summaries` — Array of `Message` objects representing the summaries about to be deleted.

**Typical uses:**

- Persisting summaries to a database before they're lost (the `memory` plugin does this)

---

### `onTaskAssistantWillBegin(callback)`

Called immediately after a task assistant's `Conversation` is created, before any user messages are sent to it.

**Registration window:** Until the first task assistant session begins.

**Callback signature:**

```typescript
(instance: ActiveTaskAssistantInstance) => Promise<void>;
```

**`ActiveTaskAssistantInstance`:**

```typescript
type ActiveTaskAssistantInstance = {
  instanceId: string;
  definition: TaskAssistantDefinition;
  parentSessionId: number;
  entryMode: TaskAssistantEntryMode; // 'chat' | 'voice'
  conversation: Conversation;
  startedAt: Date;
};
```

---

### `onTaskAssistantWillEnd(callback)`

Called when a task assistant session has ended (either completed or cancelled).

**Registration window:** Until the first task assistant session ends.

**Callback signature:**

```typescript
(instance: ActiveTaskAssistantInstance, result: TaskAssistantResult) =>
  Promise<void>;
```

**`TaskAssistantResult`:**

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

## Internal-Only Hooks

The following hooks exist in the implementation but are **not exposed** to plugins:

- `onUserPluginsUnloaded`
- `onSystemPluginsWillUnload`

These are used internally by the plugin engine during shutdown and are not part of the public API surface.

---

## Quick Reference Table

| Hook                                        | Callback Signature                      | Registration Window                            |
| ------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| `onAllPluginsLoaded`                        | `() => Promise<void>`                   | Plugin registration only                       |
| `onAssistantWillAcceptRequests`             | `() => Promise<void>`                   | Registration or `onAllPluginsLoaded`           |
| `onAssistantAcceptsRequests`                | `() => Promise<void>`                   | Through `onAssistantWillAcceptRequests`        |
| `onAssistantWillStopAcceptingRequests`      | `() => Promise<void>`                   | Through `onAssistantAcceptsRequests`           |
| `onAssistantStoppedAcceptingRequests`       | `() => Promise<void>`                   | Through `onAssistantWillStopAcceptingRequests` |
| `onPluginsWillUnload`                       | `() => Promise<void>`                   | Through `onAssistantStoppedAcceptingRequests`  |
| `onUserConversationWillBegin`               | `(conversation, type) => Promise<void>` | Until first conversation begins                |
| `onUserConversationWillEnd`                 | `(conversation, type) => Promise<void>` | Until first conversation ends                  |
| `onContextCompactionSummariesWillBeDeleted` | `(summaries) => Promise<void>`          | Until first compaction                         |
| `onTaskAssistantWillBegin`                  | `(instance) => Promise<void>`           | Until first task assistant begins              |
| `onTaskAssistantWillEnd`                    | `(instance, result) => Promise<void>`   | Until first task assistant ends                |
