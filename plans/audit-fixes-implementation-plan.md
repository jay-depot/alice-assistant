# Implementation Plan: Codebase Audit Fixes

## Overview

Fixes 14 bugs, inconsistencies, and dead-code issues identified during a full codebase audit. The fixes span core conversation logic, plugin engine, plugin lifecycle hooks, system prompt assembly, and several individual plugins.

## Requirements Summary

- Fix double-JSON-serialization bug in `recallRandomConversation`
- Normalize `tool_calls` field to `undefined` when empty across both streaming and non-streaming paths
- Deduplicate tool-call execution logic between `handleToolCalls` and `executeToolCalls`
- Merge header/footer system prompts into fewer messages for token efficiency
- Add missing registration-closed gates to `onTaskAssistantWillBegin`/`onTaskAssistantWillEnd`
- Wire `onUserConversationWillBegin`/`onUserConversationWillEnd` hooks into the web-ui plugin
- Remove deprecated `onPluginsWillUnload` handler from voice plugin (double-cleanup bug)
- Filter summaries correctly in `closeConversation` hook invocation
- Remove stale `location` field from system config schema + default config
- Remove hardcoded `assistantMood: 'happy'` from chat session API response
- Remove dead `builtInCategory` from `agents` plugin metadata
- Remove dead `onUserPluginsUnloaded`/`onSystemPluginsWillUnload` hook arrays
- Rewrite `index.ts` try/catch/exit for clarity
- Add clarifying comment to `alice-core.ts` about test-conversation timing
- Add comment to `mood.ts` explaining acceptable simple-state persistence pattern

## Project Structure

All changes follow existing conventions:

- `src/index.ts` — entry point
- `src/lib/` — core framework (conversation, plugin-hooks, conversation-types, etc.)
- `src/lib/conversation/` — conversation sub-modules
- `src/lib/types/` — Typebox config schemas
- `src/plugins/system/` — system plugin implementations
- `src/plugins/community/` — community plugin implementations
- `config-default/` — first-run scaffold config
- Tests co-located (`*.test.ts`)

## Implementation Steps

### Step 1: Fix `index.ts` exit pattern for clarity

**Files:** `src/index.ts`
**Complexity:** Low
**Dependencies:** None

Replace the `.catch().then()` chain with a plain `try/catch`. No behavioral change.

```typescript
import { AliceCore } from './lib/alice-core.js';
import { systemLogger } from './lib/system-logger.js';

try {
  await AliceCore.start();
} catch (err) {
  systemLogger.error('Fatal error', err);
  process.exit(1);
}
process.exit(0);
```

### Step 2: Extract shared tool-call execution logic in `Conversation`

**Files:** `src/lib/conversation.ts`
**Complexity:** Medium
**Dependencies:** None

`handleToolCalls` (non-streaming path) and `executeToolCalls` (streaming path) duplicate the same `executeTools()` + taint tracking + context append pattern.

Add a private helper method:

```typescript
private async runToolCallBatch(toolCalls: ToolCall[]): Promise<void> {
  const callBatchId = randomUUID();
  const { toolResultMessages, taintedToolNamesAdded } = await executeTools({
    toolCalls,
    conversationType: this.type,
    isTainted: this.isTainted,
    taintedToolNames: this.taintedToolNames,
    sessionId: this.sessionId,
    taskAssistantId: this.taskAssistantId,
    agentInstanceId: this.agentInstanceId,
    callBatchId,
  });

  for (const toolName of taintedToolNamesAdded) {
    this.taintedToolNames.add(toolName);
  }

  for (const msg of toolResultMessages) {
    await this.appendToContext(msg);
  }
}
```

Replace both `executeTools()` call sites:

**In `executeToolCalls` (lines 264-296):** Replace lines 278-296 with a call to `this.runToolCallBatch(toolCalls)`. Keep the `maxToolCallDepth` guard and system message at the top.

**In `handleToolCalls` (lines 300-383):** Replace lines 325-344 with a call to `this.runToolCallBatch(toolCalls)`. The `callBatchId` variable is no longer needed locally since `runToolCallBatch` generates its own. Remove the `callBatchId` local declaration at line 325.

### Step 3: Normalize `tool_calls` storage to `undefined` when empty

**Files:** `src/lib/conversation.ts`
**Complexity:** Low
**Dependencies:** Step 2 preferred (same file)

In `handleToolCalls` at line 191, change:

```typescript
tool_calls: toolCalls,
```

to:

```typescript
tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
```

The streaming path already does this at line 254. This ensures all call sites consistently store `undefined` (not an empty array) when there are no tool calls.

Also check line 372 (inside `handleToolCalls` recursion, the next response's tool_calls) and line 421 (in `fallbackAfterToolCallLimit`). Apply the same normalization there.

### Step 4: Merge header and footer system prompts into fewer messages

**Files:** `src/lib/conversation/prompt-assembler.ts`
**Complexity:** Low
**Dependencies:** None

Change the `assembleFullContext` function to merge header prompts into a single system message and footer prompts into another:

```typescript
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

  const result: Message[] = [];

  if (headerPrompts.length > 0) {
    result.push({ role: 'system', content: headerPrompts.join('\n\n') });
  }

  result.push(...compactedContext);

  if (footerPrompts.length > 0) {
    result.push({ role: 'system', content: footerPrompts.join('\n\n') });
  }

  return result;
}
```

### Step 5: Add registration-closed gates to task-assistant hooks

**Files:** `src/lib/plugin-hooks.ts`
**Complexity:** Low
**Dependencies:** None

These two hooks are the only ones without late-registration checks.

1. Add entries to `isRegistrationOpenForHook`:

```typescript
onTaskAssistantWillBegin: true,
onTaskAssistantWillEnd: true,
```

2. Add guard clauses to the registration functions (lines 164-176):

```typescript
onTaskAssistantWillBegin: (callback) => {
  if (!isRegistrationOpenForHook.onTaskAssistantWillBegin) {
    throw new Error(
      `${pluginId} tried to register onTaskAssistantWillBegin too late. ` +
      `The onTaskAssistantWillBegin hook can only be registered before the first ` +
      `task assistant session begins. Please disable ${pluginId} to fix your assistant. ` +
      `If you are developing this plugin, check your hook timings.`
    );
  }
  registeredHooks.onTaskAssistantWillBegin.push(callback);
},
onTaskAssistantWillEnd: (callback) => {
  if (!isRegistrationOpenForHook.onTaskAssistantWillEnd) {
    throw new Error(
      `${pluginId} tried to register onTaskAssistantWillEnd too late. ` +
      `The onTaskAssistantWillEnd hook can only be registered before the first ` +
      `task assistant session ends. Please disable ${pluginId} to fix your assistant. ` +
      `If you are developing this plugin, check your hook timings.`
    );
  }
  registeredHooks.onTaskAssistantWillEnd.push(callback);
},
```

3. Close registration when hooks are first dispatched. These are fired from the `TaskAssistantEvents` callbacks at the bottom of `plugin-hooks.ts` (lines 278-306). Close them at the top of each callback:

```typescript
TaskAssistantEvents.onBegin(async (instance: ActiveTaskAssistantInstance) => {
  isRegistrationOpenForHook.onTaskAssistantWillBegin = false;
  // ... rest of dispatch
});

TaskAssistantEvents.onEnd(async (instance, result) => {
  isRegistrationOpenForHook.onTaskAssistantWillEnd = false;
  // ... rest of dispatch
});
```

### Step 6: Wire `onUserConversationWillBegin`/`onUserConversationWillEnd` into web-ui

**Files:** `src/plugins/system/web-ui/web-ui.ts`
**Complexity:** Medium
**Dependencies:** Step 5 (same module `plugin-hooks.ts` is already imported)

The voice plugin already fires these hooks. The web-ui plugin needs them for:

- **`onUserConversationWillBegin`:** Fire when a new user conversation starts in the chat UI. The right call site is inside `PATCH /api/chat/:id` at the start of `runSessionOperation`, right after we confirm the session exists and the LLM transaction is created. Specifically, fire it once before the first `appendExternalMessage` for the user's message.

- **`onUserConversationWillEnd`:** Fire when a chat session is closed. The right call site is inside `closeAndEvictCachedConversation` (line 388-399 of web-ui.ts).

Add an import for `PluginHookInvocations` (already available via `lib.js` re-export):

```typescript
// In PATCH /api/chat/:id, inside runSessionOperation, before the streaming loop:
// Fire the hook once when this is the first user message in the conversation.
// We detect "first message" by checking if there are no prior user messages.
const hasPriorUserMessages = queuedSession.rounds
  .getItems()
  .some(round => round.role === 'user');
if (!hasPriorUserMessages) {
  await PluginHookInvocations.invokeOnUserConversationWillBegin(
    llmTransaction,
    'chat'
  );
}
```

For `onUserConversationWillEnd`, in `closeAndEvictCachedConversation`:

```typescript
const closeAndEvictCachedConversation = async (
  sessionId: number
): Promise<void> => {
  const conversation = cachedChatConversations.get(sessionId);
  if (!conversation) {
    return;
  }

  await PluginHookInvocations.invokeOnUserConversationWillEnd(
    conversation,
    'chat'
  );
  await flushCachedConversation(sessionId);
  await conversation.closeConversation();
  evictCachedConversation(sessionId);
};
```

**Important:** The `agents` plugin registers `onUserConversationWillEnd` (agents.ts:164) to call `AgentSystem.cancelBySession(sessionId)`. This was dead code until now. Once wired, agents will be properly cancelled when a chat session ends.

### Step 7: Remove duplicate `onPluginsWillUnload` handler from voice plugin

**Files:** `src/plugins/system/voice/voice.ts`
**Complexity:** Low
**Dependencies:** None

Remove lines 252-260:

```typescript
plugin.hooks.onPluginsWillUnload(async () => {
  plugin.logger.log(
    'onPluginsWillUnload: Starting final voice runtime shutdown.'
  );
  await closeVoiceRuntime();
  plugin.logger.log(
    'onPluginsWillUnload: Completed final voice runtime shutdown.'
  );
});
```

`closeVoiceRuntime()` is already called in `onAssistantWillStopAcceptingRequests` (line 242-250). The duplicate call runs after the memory plugin has closed the ORM, causing broken database access.

### Step 8: Fix `closeConversation` to pass only summaries to hook

**Files:** `src/lib/conversation/context-manager.ts`
**Complexity:** Low
**Dependencies:** None

In `closeConversation` (lines 107-110), filter to only summary messages before passing to the hook:

```typescript
const summaryMessages = this.conv.compactedContext.filter(m =>
  m.content.startsWith(SUMMARY_HEADER)
);
await PluginHookInvocations.invokeOnContextCompactionSummariesWillBeDeleted(
  summaryMessages,
  this.conv.type
);
```

### Step 9: Remove stale `location` field from system config

**Files:**

- `src/lib/types/system-config-basic.ts`
- `config-default/alice.json`
  **Complexity:** Low
  **Dependencies:** None

**system-config-basic.ts:** Remove line 6:

```typescript
location: Type.String(), // TODO: This needs to be moved into the static-location plugin config
```

No code references `config.location` anywhere in the codebase. The `static-location` plugin has its own config schema with `localityName`, `regionName`, `countryName`, and `coordinates`.

**config-default/alice.json:** No removal needed — the field isn't present in the default config (it was never populated).

### Step 10: Remove hardcoded `assistantMood: 'happy'` from chat API response

**Files:** `src/plugins/system/web-ui/web-ui.ts`
**Complexity:** Low
**Dependencies:** None

In `GET /api/chat/:id` (line 1229), remove the `assistantMood` field:

```typescript
// Before (line 1224-1237):
res.json({
  session: {
    id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    assistantMood: 'happy', // ← REMOVE THIS LINE
    messages: session.rounds
      ...
  },
});

// After:
res.json({
  session: {
    id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.rounds
      .getItems()
      .filter(round => round.role !== 'system' && round.role !== 'tool')
      .map(serializeRound),
    activeAgents: getActiveAgentsForSession(session.id),
  },
});
```

The mood plugin provides `/api/mood` separately. The client should use that endpoint instead.

### Step 11: Fix double-JSON-serialize in `recallRandomConversation`

**Files:** `src/plugins/system/memory/memory.ts`
**Complexity:** Low
**Dependencies:** None

Lines 329-331:

```typescript
// Before:
const randomMemory = JSON.stringify(memory);
return JSON.stringify({ memory: randomMemory });

// After:
return JSON.stringify({ memory });
```

The outer `JSON.stringify` will call the MikroORM entity's built-in serialization via `toJSON()`, producing a proper object instead of a doubly-escaped string.

### Step 12: Remove dead `builtInCategory` from agents plugin metadata

**Files:** `src/plugins/system/agents/agents.ts`
**Complexity:** Low
**Dependencies:** None

Remove line 26:

```typescript
builtInCategory: 'system',
```

The loader (`alice-plugin-loader.ts:223`) always overwrites this from `system-plugins.json`, so the declared value is dead metadata. No other plugin declares `builtInCategory` in its metadata object.

### Step 13: Remove dead `onUserPluginsUnloaded`/`onSystemPluginsWillUnload` hook arrays

**Files:** `src/lib/plugin-hooks.ts`
**Complexity:** Low
**Dependencies:** None

These are placeholders for hot-unloading (not yet implemented). Remove from three locations:

1. **`registeredHooks` type (lines 36-37):**
   ```typescript
   onUserPluginsUnloaded: Array<() => Promise<void>>;
   onSystemPluginsWillUnload: Array<() => Promise<void>>;
   ```
2. **`registeredHooks` initialization (lines 57-58):**

   ```typescript
   onUserPluginsUnloaded: [],
   onSystemPluginsWillUnload: [],
   ```

3. **`isRegistrationOpenForHook` (lines 73-74):**
   ```typescript
   onUserPluginsUnloaded: true,
   onSystemPluginsWillUnload: true,
   ```

### Step 14: Add clarifying comment to `alice-core.ts` about test conversation timing

**Files:** `src/lib/alice-core.ts`
**Complexity:** Low
**Dependencies:** None

Add a comment at line 60, before the test conversation block:

```typescript
// Validate Ollama connectivity with a startup-type conversation before accepting
// external requests. The REST server is not yet listening at this point — this is
// an internal-only connectivity check. If the LLM is unreachable or produces a
// degenerate response, the assistant will fail fast before opening any ports.
await PluginHookInvocations.invokeOnAssistantWillAcceptRequests();
await (async () => {
  const testConversation = startConversation('startup');
  ...
```

### Step 15: Add comment to `mood.ts` about simple-state persistence pattern

**Files:** `src/plugins/community/mood/mood.ts`
**Complexity:** Low
**Dependencies:** None

Add a comment at the `saveMood` function definition (line 115):

```typescript
// Mood state is a single key-value pair that benefits from surviving restarts
// but does not warrant a full database entity. File-based persistence is
// acceptable for this class of very simple plugin state.
function saveMood(mood: string, reason: string) {
  ...
```

## File Changes Summary

| File                                       | Action    | Description                                                          |
| ------------------------------------------ | --------- | -------------------------------------------------------------------- |
| `src/index.ts`                             | Modify    | Rewrite as `try/catch/exit` for clarity                              |
| `src/lib/conversation.ts`                  | Modify    | Extract `runToolCallBatch()`, normalize `tool_calls` to `undefined`  |
| `src/lib/conversation/prompt-assembler.ts` | Modify    | Merge header/footer prompts into single system messages              |
| `src/lib/conversation/context-manager.ts`  | Modify    | Filter to summary-only messages in `closeConversation` hook call     |
| `src/lib/plugin-hooks.ts`                  | Modify    | Add gates to task-assistant hooks; remove dead unload hook arrays    |
| `src/lib/types/system-config-basic.ts`     | Modify    | Remove `location` field                                              |
| `src/plugins/system/web-ui/web-ui.ts`      | Modify    | Wire `onUserConversationWillBegin/End`; remove `assistantMood` field |
| `src/plugins/system/voice/voice.ts`        | Modify    | Remove duplicate `onPluginsWillUnload` handler                       |
| `src/plugins/system/memory/memory.ts`      | Modify    | Fix double-JSON-serialize in `recallRandomConversation`              |
| `src/plugins/system/agents/agents.ts`      | Modify    | Remove dead `builtInCategory` from metadata                          |
| `src/plugins/community/mood/mood.ts`       | Modify    | Add comment about simple-state persistence                           |
| `src/lib/alice-core.ts`                    | Modify    | Add comment about test-conversation timing                           |
| `config-default/alice.json`                | No change | `location` field was never present                                   |

## Testing Strategy

### Unit tests to add/modify

1. **`src/lib/conversation.test.ts`:** Add tests for `runToolCallBatch()`:
   - Verifies tainted tool names are tracked
   - Verifies tool result messages are appended to context
   - Verifies callBatchId is generated

2. **`src/lib/conversation/prompt-assembler.test.ts`:** Add test that header/footer prompts are merged into single messages when present, and omitted entirely when absent.

3. **`src/lib/plugin-hooks.test.ts` (new):** Add tests for:
   - `onTaskAssistantWillBegin` gate throws after first `start()`
   - `onTaskAssistantWillEnd` gate throws after first `complete()`/`cancel()`

4. **`src/plugins/system/memory/memory.test.ts`:** Add test for `recallRandomConversation` output format (no double-encoded JSON).

### Manual testing steps

1. Start the assistant with `npm start` — verify it boots, test conversation succeeds, and REST server starts.
2. Open web UI, create a chat, send a message — verify streaming works and tool calls function.
3. End a chat session — verify the agents panel closes and no errors appear in logs.
4. Trigger `recallRandomConversation` via chat — verify the tool returns a plain JSON object, not an escaped string.
5. Shut down with Ctrl+C — verify clean shutdown with no ORM errors in logs.
6. Inspect `GET /api/chat/:id` response — verify `assistantMood` field is absent.

### Existing tests requiring mock updates

All test files that mock `PluginHookInvocations` will continue to work since the mock already includes `invokeOnUserConversationWillBegin` and `invokeOnUserConversationWillEnd`. No changes needed.

## Definition of Done

- [ ] `src/index.ts` uses `try/catch` pattern
- [ ] `Conversation.runToolCallBatch()` exists and is called from both `handleToolCalls` and `executeToolCalls`
- [ ] All `tool_calls` storage sites normalize empty arrays to `undefined`
- [ ] `assembleFullContext` returns at most 2 system messages (1 header, 1 footer) plus conversation
- [ ] `onTaskAssistantWillBegin` and `onTaskAssistantWillEnd` throw when registered after their gates close
- [ ] `onUserConversationWillBegin` fires when a web-ui chat receives its first user message
- [ ] `onUserConversationWillEnd` fires when a web-ui chat session is closed/deleted
- [ ] Voice plugin does not register `onPluginsWillUnload`
- [ ] `closeConversation` passes only summary messages to `onContextCompactionSummariesWillBeDeleted`
- [ ] `SystemConfigBasic` no longer contains `location` field
- [ ] `GET /api/chat/:id` response does not include `assistantMood`
- [ ] `recallRandomConversation` returns `{"memory":{...}}` not `{"memory":"{...}"}`
- [ ] `agents` plugin metadata does not contain `builtInCategory`
- [ ] `plugin-hooks.ts` does not contain `onUserPluginsUnloaded` or `onSystemPluginsWillUnload`
- [ ] `alice-core.ts` has comment explaining test conversation timing
- [ ] `mood.ts` has comment explaining simple-state persistence
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Assistant starts, accepts chat/voice requests, and shuts down cleanly

## Risks & Mitigations

| Risk                                                                                                 | Impact                                                                      | Mitigation                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runToolCallBatch()` refactor breaks tool-call ordering                                              | Tool results may arrive in wrong sequence                                   | Both paths already use the same `executeTools()` function; the refactor only consolidates the result-handling loop around it. Test with multi-tool scenarios.                                                                                                       |
| Merging system prompts changes LLM behavior                                                          | Model may respond differently when prompts are joined vs. separate messages | The merge uses `\n\n` separator which preserves the visual structure. Test with the startup conversation to confirm output quality.                                                                                                                                 |
| Wiring `onUserConversationWillEnd` into web-ui causes double-firing with voice                       | The `agents` plugin's `cancelBySession` could be called redundantly         | `AgentSystem.cancelBySession` is idempotent (checks instance existence and status). Safe to call twice.                                                                                                                                                             |
| Removal of `location` from config schema causes Typebox validation failures in existing user configs | Startup crash if user's `alice.json` has a `location` field                 | Validation isn't actually applied at runtime (no `Type.Check` call — there's a TODO for convict integration). The field removal is purely a type-level change. Existing JSON files with the field will parse fine since `JSON.parse` doesn't care about extra keys. |

## Timeline Estimate

All items are straightforward, with the `runToolCallBatch` extraction being the only medium-complexity change. Estimated total: **2-3 hours** including testing.

- Steps 1, 3, 7-15: ~15 minutes each (minor changes)
- Step 2 (extract `runToolCallBatch`): ~30 minutes (refactor + verify both call paths)
- Step 4 (merge prompts): ~15 minutes
- Step 5 (task-assistant hook gates): ~20 minutes
- Step 6 (wire user-conversation hooks into web-ui): ~30 minutes (needs careful call-site placement)
- Run lint + full test suite: ~15 minutes
- Manual smoke testing: ~30 minutes
