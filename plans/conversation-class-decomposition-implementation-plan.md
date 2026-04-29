# Implementation Plan: Conversation Class Decomposition

## Overview

Decompose the 1073-line `Conversation` god class (`src/lib/conversation.ts`) into focused sub-modules, eliminate the ~90% duplicated tool-call execution logic between `handleToolCalls()` and `executeToolCalls()`, and make each concern independently testable.

**Goals:**

- Shrink `Conversation` to a thin orchestrator (~200 lines)
- Unify the two duplicated tool-execution code paths into one shared module
- Extract prompt assembly, context compaction, and streaming iteration into testable sub-modules
- Preserve the existing public API surface so all 11+ call sites work unchanged

## Requirements Summary

### Functional

- `sendUserMessage()` must continue to return final LLM content after resolving all tool-call chains recursively
- `beginStreaming()` must continue to return `{ content, thinking, toolCalls }` token-by-token
- `executeToolCalls()` must continue as a public method on `Conversation` for the streaming path
- Context compaction (`compactContext`, `maybeCompactContext`, `closeConversation`) must preserve all three modes: `'normal'`, `'full'`, `'clear'`
- `restoreContext()` must continue to enforce single-call guard
- Unsynchronized-message tracking (`getUnsynchronizedMessages`, `markUnsynchronizedMessagesSynchronized`) must work identically
- `maybeRequestTitle()` must work identically
- `sendDirectRequest()` (static) must work identically
- `appendExternalMessage()` must work identically
- Taint tracking (`taintedToolNames`, `isTainted`) must be accessible on the `Conversation` instance

### Non-Functional

- Zero breaking changes to the public API
- All 21 existing tests in `conversation.test.ts` must continue to pass
- New sub-modules must have their own `*.test.ts` files co-located
- Follow all project conventions: ESM with `.js` extensions, kebab-case filenames, `vi.mock()` at top level for tests
- `lib.ts` must continue to re-export everything consumers need

### Out of Scope

- Changing the `Conversation` public API shape
- Refactoring callers (web-ui, agent-system, voice, etc.)
- Adding new features (approval flows, tracing, etc.)
- Extracting the broker pattern (that's a separate refactoring)

## Architecture & Design

### Text-based architecture diagram

```
Before:
  conversation.ts (1073 lines)
    ├── Conversation class
    │   ├── static sendDirectRequest()
    │   ├── constructor + state (rawContext, compactedContext, taint, sessionId, ...)
    │   ├── restoreContext / getUnsynchronizedMessages / markUnsynchronizedMessagesSynchronized
    │   ├── appendExternalMessage
    │   ├── compactContext (normal/full/clear) → calls maybeCompactContext
    │   ├── maybeCompactContext (private) → summarize + LLM call
    │   ├── sendUserMessage → prompt assembly + LLM call + handleToolCalls
    │   ├── beginStreaming → prompt assembly + stream iteration
    │   ├── executeToolCalls → DUPLICATED tool-loop logic (~120 lines)
    │   ├── handleToolCalls (private) → DUPLICATED tool-loop logic + recursive LLM (~260 lines)
    │   ├── closeConversation
    │   └── maybeRequestTitle
    └── checkLLMResponseForDegeneracy (pure function)

After:
  src/lib/conversation/
    ├── conversation.ts                  → ~200 lines: thin orchestrator, delegates to sub-modules
    ├── context-manager.ts               → ~200 lines: compaction, closeConversation, restoreContext
    ├── prompt-assembler.ts              → ~80 lines: header/footer fetching + fullContext building
    ├── tool-executor.ts                 → ~150 lines: unified tool dispatch (single source of truth)
    ├── streaming-handler.ts             → ~80 lines: stream iteration loop
    ├── degeneracy-check.ts             → ~30 lines: checkLLMResponseForDegeneracy (extracted)
    └── types.ts                         → ~40 lines: Message, StreamingCallbacks, Options types

  src/lib/conversation/ → corresponding test files:
    ├── context-manager.test.ts
    ├── prompt-assembler.test.ts
    ├── tool-executor.test.ts
    ├── streaming-handler.test.ts
    └── degeneracy-check.test.ts (moved from existing suite)
```

### Component breakdown

| Module                 | Responsibility                                                                                                                           | Key exports                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `conversation.ts`      | Thin orchestrator; holds rawContext/compactedContext/taint state; delegates to sub-modules                                               | `Conversation`, `startConversation`                                 |
| `types.ts`             | `Message`, `ConversationStreamingCallbacks`, `StartConversationOptions`                                                                  | All three types                                                     |
| `degeneracy-check.ts`  | Pure function `checkLLMResponseForDegeneracy`                                                                                            | `checkLLMResponseForDegeneracy`, `SUMMARY_HEADER`, `SUMMARY_PROMPT` |
| `context-manager.ts`   | context compaction, `closeConversation`, `restoreContext` guard, unsynchronized-message tracking                                         | `ConversationContextManager` class                                  |
| `prompt-assembler.ts`  | Fetches header/footer prompts, builds `fullContext` array                                                                                | `promptAssembler`, `buildFullContext`                               |
| `tool-executor.ts`     | **Single source of truth** for tool dispatch: lookup → taint check → event dispatch → execute → error wrapping → returns result messages | `executeTools`                                                      |
| `streaming-handler.ts` | Consumes Ollama's streaming `AbortableAsyncIterator`, accumulates `content`/`thinking`/`toolCalls`, fires callbacks                      | `iterateStream`                                                     |

### Data models

No new data models. The existing `Message`, `ConversationStreamingCallbacks`, and `StartConversationOptions` types move to `types.ts`.

### API contracts

**Public API (unchanged from caller perspective):**

```typescript
// conversation.ts still exports these
export class Conversation {
  static sendDirectRequest(messages: Message[]): Promise<string>;

  rawContext: Message[];
  compactedContext: Message[];
  taintedToolNames: Set<string>;
  readonly isTainted: boolean;
  type: DynamicPromptConversationType;
  sessionId?: number;
  taskAssistantId?: string;
  agentInstanceId?: string;

  constructor(type: DynamicPromptConversationType, sessionId?, taskAssistantId?, agentInstanceId?);

  restoreContext(context: Message[], compactedContext?: Message[]): Conversation;
  getUnsynchronizedMessages(): Message[];
  markUnsynchronizedMessagesSynchronized(): void;
  appendExternalMessage(message: Message): Promise<void>;
  compactContext(mode: 'normal' | 'full' | 'clear'): Promise<boolean>;
  sendUserMessage(userMessage?: string): Promise<string>;
  beginStreaming(callbacks: ConversationStreamingCallbacks, options?: {...}): Promise<{content, thinking, toolCalls}>;
  executeToolCalls(toolCalls: ToolCall[], depth?: number): Promise<void>;
  closeConversation(): Promise<void>;
  maybeRequestTitle(): Promise<string | undefined>;
}

export function startConversation(type, options?): Conversation;

// Re-exported from sub-modules via conversation.ts
export { Message, ConversationStreamingCallbacks, StartConversationOptions, checkLLMResponseForDegeneracy, SUMMARY_HEADER };
```

**Internal API between sub-modules:**

```typescript
// context-manager.ts
export class ConversationContextManager {
  constructor(conversation: Conversation); // holds reference for state access
  restoreContext(
    context: Message[],
    compactedContext?: Message[]
  ): Conversation; // returns for chaining
  getUnsynchronizedMessages(): Message[];
  markUnsynchronizedMessagesSynchronized(): void;
  appendToContext(message: Message): Promise<void>; // pushes + triggers maybeCompactContext
  compactContext(mode: 'normal' | 'full' | 'clear'): Promise<boolean>;
  maybeCompactContext(): Promise<boolean>;
  closeConversation(): Promise<void>;
}

// prompt-assembler.ts
export type PromptAssemblerContext = {
  conversationType: DynamicPromptConversationType;
  sessionId?: number;
  taskAssistantId?: string;
  toolCallsAllowed: boolean;
  availableTools: string[];
};

export async function assembleFullContext(
  assemblerCtx: PromptAssemblerContext,
  compactedContext: Message[]
): Promise<Message[]>;

// tool-executor.ts
export type ToolExecutionInput = {
  toolCalls: ToolCall[];
  conversationType: DynamicPromptConversationType;
  isTainted: boolean;
  taintedToolNames: Set<string>;
  sessionId?: number;
  taskAssistantId?: string;
  agentInstanceId?: string;
  callBatchId: string;
};

export type ToolExecutionOutput = {
  /** Tool-role messages to append to context. */
  toolResultMessages: Array<{
    role: 'tool';
    content: string;
    tool_name: string;
  }>;
  /** Whether any tainted tool was executed in this batch. */
  taintedToolNamesAdded: string[];
};

export async function executeTools(
  input: ToolExecutionInput
): Promise<ToolExecutionOutput>;

// streaming-handler.ts
export async function iterateStream(
  streamIterator: AbortableAsyncIterator<ChatResponse>,
  callbacks: ConversationStreamingCallbacks
): Promise<{ content: string; thinking: string; toolCalls: ToolCall[] }>;

// degeneracy-check.ts
export function checkLLMResponseForDegeneracy(response: string): void;
export const SUMMARY_HEADER: string;
export const SUMMARY_PROMPT: string;
```

## New Package Dependencies

None. This is a pure extraction refactoring — no new packages needed.

## Project Structure

```
src/lib/conversation/           ← new directory
├── conversation.ts             ← new file (thin orchestrator, ~200 lines)
├── types.ts                    ← new file (extracted types)
├── degeneracy-check.ts         ← new file (extracted pure function + constants)
├── context-manager.ts          ← new file (~200 lines)
├── prompt-assembler.ts         ← new file (~80 lines)
├── tool-executor.ts            ← new file (~150 lines)
├── streaming-handler.ts        ← new file (~80 lines)
├── context-manager.test.ts     ← new file
├── prompt-assembler.test.ts    ← new file
├── tool-executor.test.ts       ← new file
├── streaming-handler.test.ts   ← new file
└── degeneracy-check.test.ts    ← new file

src/lib/conversation.test.ts    ← KEPT, updated to import from new location
src/lib/conversation-types.ts   ← unchanged
src/lib.ts                      ← minimal update: export path changes
src/lib/types/alice-plugin-hooks.ts  ← import path update: '../conversation.js' → '../conversation/conversation.js'
```

## Implementation Steps

### Step 1: Extract types and constants (no logic changes)

**Description:** Move `Message`, `ConversationStreamingCallbacks`, `StartConversationOptions` types, and the `SUMMARY_HEADER`/`SUMMARY_PROMPT` constants to new files. Create the subdirectory.

**Files to create:**

- `src/lib/conversation/types.ts`

**Files to create:**

- `src/lib/conversation/degeneracy-check.ts`

**Dependencies:** None
**Complexity:** Low

---

### Step 2: Extract `checkLLMResponseForDegeneracy` to its own module

**Description:** Move the pure function and its test suite to `src/lib/conversation/degeneracy-check.ts`. The function has no dependencies on `Conversation` state and is tested in isolation.

**Files to create:**

- `src/lib/conversation/degeneracy-check.ts`
- `src/lib/conversation/degeneracy-check.test.ts`

**Files to modify:**

- `src/lib/conversation.ts` — import from new location, re-export

**Dependencies:** Step 1
**Complexity:** Low

---

### Step 3: Extract `PromptAssembler`

**Description:** Extract the duplicated prompt-assembly blocks from `sendUserMessage()` (lines 403–429) and `beginStreaming()` (lines 489–519) into `prompt-assembler.ts`. The shared `assembleFullContext()` function accepts a `PromptAssemblerContext` and the `compactedContext` array, returns the `fullContext: Message[]`.

**Files to create:**

- `src/lib/conversation/prompt-assembler.ts`
- `src/lib/conversation/prompt-assembler.test.ts`

**Files to modify:**

- `src/lib/conversation.ts` — both methods call `assembleFullContext()` instead of inline assembly

**Dependencies:** Step 1
**Complexity:** Low

---

### Step 4: Extract `ConversationContextManager`

**Description:** Move context-compaction logic (`compactContext`, `maybeCompactContext`, `closeConversation`) and session-state helpers (`restoreContext`, `getUnsynchronizedMessages`, `markUnsynchronizedMessagesSynchronized`, `appendToContext`) into a separate class. `ConversationContextManager` takes a reference to the parent `Conversation` to read/write `rawContext`, `compactedContext`, and `llmConnection`.

This is the trickiest extraction because:

- `maybeCompactContext` calls `OllamaClient.chat` directly (needs `llmConnection`)
- `compactContext` in `'full'`/`'clear'` modes calls `Conversation.sendDirectRequest()`
- `closeConversation` also calls `sendDirectRequest()` and fires the plugin hook
- The `appendToContext` method triggers `maybeCompactContext` automatically

**Design decision:** `ConversationContextManager` will accept the `Conversation` instance in its constructor and access public fields directly. `sendDirectRequest` will be passed as a dependency or called statically. Since `sendDirectRequest` is a `static` method, the manager can call `Conversation.sendDirectRequest()` directly.

**Files to create:**

- `src/lib/conversation/context-manager.ts`
- `src/lib/conversation/context-manager.test.ts`

**Files to modify:**

- `src/lib/conversation.ts` — create a `contextManager` field; delegate method calls

**Dependencies:** Step 1
**Complexity:** High

---

### Step 5: Extract `ToolExecutor` (the unified tool dispatch)

**Description:** Create a **single** `executeTools()` function that both `sendUserMessage` (via `handleToolCalls`) and `beginStreaming` (via `executeToolCalls`) use. This function:

1. Takes `ToolExecutionInput` (toolCalls, conversation type, taint state, session IDs, callBatchId)
2. For each tool call: looks up the tool, enforces taint security, dispatches `tool_call_started` event
3. Executes the tool, dispatches `tool_call_completed` or `tool_call_error` event
4. Returns `ToolExecutionOutput` with `toolResultMessages` and `taintedToolNamesAdded`

The returned `toolResultMessages` are appended to context by the **caller** (clean separation — the executor does not mutate conversation state). The caller also adds any returned `taintedToolNamesAdded` to `conversation.taintedToolNames`.

**Files to create:**

- `src/lib/conversation/tool-executor.ts`
- `src/lib/conversation/tool-executor.test.ts`

**Files to modify:**

- `src/lib/conversation.ts` — both `handleToolCalls` and `executeToolCalls` call `executeTools()` instead of inline dispatch

**Dependencies:** Step 1
**Complexity:** Medium

---

### Step 6: Extract `StreamingHandler`

**Description:** Extract the stream iteration loop from `beginStreaming()` (lines 540–567) into `iterateStream()`. This function takes the `AbortableAsyncIterator<ChatResponse>` and callbacks, iterates chunks, accumulates content/thinking/toolCalls, and fires callbacks. Returns `{ content, thinking, toolCalls }`.

**Files to create:**

- `src/lib/conversation/streaming-handler.ts`
- `src/lib/conversation/streaming-handler.test.ts`

**Files to modify:**

- `src/lib/conversation.ts` — `beginStreaming()` calls `iterateStream()` instead of inline iteration

**Dependencies:** Step 1
**Complexity:** Low

---

### Step 7: Rebuild `Conversation` as a thin orchestrator

**Description:** With all sub-modules extracted, simplify `conversation.ts` so the `Conversation` class:

- Instantiates `ConversationContextManager` in the constructor
- Delegates compaction/context methods to `contextManager`
- Calls `assembleFullContext()`, `executeTools()`, `iterateStream()` where needed
- Keeps only the high-level orchestration logic: the decision of "after tool calls, should I recurse into the LLM or return?"

The key structural difference between the old `handleToolCalls` (recursive) and the streaming path (iterative `while(true)`) remains in `Conversation` itself — that's the orchestrator's job.

**Files to modify:**

- `src/lib/conversation/conversation.ts` — rewrite to ~200 lines

**Files to create:**

- `src/lib/conversation/conversation.test.ts` — move existing tests here, update imports

**Files to delete/archive:**

- `src/lib/conversation.ts` (old, at root of lib/) — removed; `lib.ts` import path changes

**Dependencies:** Steps 1–6
**Complexity:** Medium

---

### Step 8: Update all import paths

**Description:** Update every file that imports from `./conversation.js` or `../../../lib/conversation.js` to point to the new `conversation/conversation.js` path. Also update `lib.ts` to re-export from the new location.

**Files to modify:**

- `src/lib.ts` — `export * from './lib/conversation/conversation.js';`
- `src/lib/agent-system.ts` — import path
- `src/lib/task-assistant.ts` — import path
- `src/lib/alice-core.ts` — import path
- `src/lib/types/alice-plugin-hooks.ts` — import path
- `src/plugins/system/scratch-files/scratch-files-index.ts` — import path
- `src/lib/conversation.test.ts` — import path (moved test file)

**Dependencies:** Step 7
**Complexity:** Low

---

### Step 9: Verify full test suite passes

**Description:** Run `npm test` and fix any failures. Run `npm run lint`. Run `npm run build` to ensure the build works end-to-end.

**Dependencies:** Step 8
**Complexity:** Low

---

## File Changes Summary

| File                                                      | Action     | Description                                                                               |
| --------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| `src/lib/conversation/types.ts`                           | **Create** | Extract `Message`, `ConversationStreamingCallbacks`, `StartConversationOptions`           |
| `src/lib/conversation/degeneracy-check.ts`                | **Create** | Extract `checkLLMResponseForDegeneracy`, `SUMMARY_HEADER`, `SUMMARY_PROMPT`               |
| `src/lib/conversation/prompt-assembler.ts`                | **Create** | Extract `assembleFullContext()`                                                           |
| `src/lib/conversation/context-manager.ts`                 | **Create** | Extract `ConversationContextManager` class                                                |
| `src/lib/conversation/tool-executor.ts`                   | **Create** | Extract unified `executeTools()` function                                                 |
| `src/lib/conversation/streaming-handler.ts`               | **Create** | Extract `iterateStream()` function                                                        |
| `src/lib/conversation/conversation.ts`                    | **Create** | Thin `Conversation` orchestrator (~200 lines)                                             |
| `src/lib/conversation.ts`                                 | **Delete** | Old 1073-line god class                                                                   |
| `src/lib/conversation/degeneracy-check.test.ts`           | **Create** | Tests for degeneracy checker                                                              |
| `src/lib/conversation/prompt-assembler.test.ts`           | **Create** | Tests for prompt assembly                                                                 |
| `src/lib/conversation/context-manager.test.ts`            | **Create** | Tests for context manager                                                                 |
| `src/lib/conversation/tool-executor.test.ts`              | **Create** | Tests for unified tool executor                                                           |
| `src/lib/conversation/streaming-handler.test.ts`          | **Create** | Tests for streaming handler                                                               |
| `src/lib/conversation/conversation.test.ts`               | **Create** | Moved/converted existing orchestration-level tests                                        |
| `src/lib/conversation.test.ts`                            | **Delete** | Replaced by files in conversation/ subdirectory                                           |
| `src/lib.ts`                                              | **Modify** | Update `export *` to point to `./lib/conversation/conversation.js`                        |
| `src/lib/agent-system.ts`                                 | **Modify** | Import path: `./conversation.js` → `./conversation/conversation.js`                       |
| `src/lib/task-assistant.ts`                               | **Modify** | Import path: `./conversation.js` → `./conversation/conversation.js`                       |
| `src/lib/alice-core.ts`                                   | **Modify** | Import path: `./conversation.js` → `./conversation/conversation.js`                       |
| `src/lib/types/alice-plugin-hooks.ts`                     | **Modify** | Import path: `../conversation.js` → `../conversation/conversation.js`                     |
| `src/plugins/system/scratch-files/scratch-files-index.ts` | **Modify** | Import path: `../../../lib/conversation.js` → `../../../lib/conversation/conversation.js` |

## Testing Strategy

### Unit tests (new, per module)

**`degeneracy-check.test.ts`** (migrated from existing):

- Normal response → no throw
- 21+ word repetitions → throws with "degenerate"
- 20 or fewer repetitions → no throw
- Tool-call dumped as garbage unicode + JSON → throws with "degenerate"

**`prompt-assembler.test.ts`:**

- `assembleFullContext` returns correct array structure with header-prompts + context + footer-prompts
- When `toolCallsAllowed` is false, toolsHeader prompt is excluded from header prompts
- Empty `compactedContext` produces correct output with only prompts

**`tool-executor.test.ts`:**

- Single clean tool call → returns one result message, no taint added
- Single tainted tool call → returns result message, `taintedToolNamesAdded` contains tool name
- Secure tool in tainted conversation → returns error message, no execution
- Unknown tool → returns "not recognized" message
- Tool throws error → returns error message, dispatches `tool_call_error` event
- Multiple mixed tool calls → each handled independently via `Promise.all`
- Events dispatched: `tool_call_started`, `tool_call_completed`, `tool_call_error` fire correctly

**`context-manager.test.ts`:**

- `restoreContext` sets rawContext and compactedContext
- `restoreContext` returns `Conversation` for chaining
- `restoreContext` throws if called twice
- `compactContext('normal')` returns false for small context
- `compactContext('full')` summarizes all non-summary messages
- `compactContext('full')` returns false when everything is already summaries
- `compactContext('clear')` evicts summaries and fires hook
- `closeConversation` summarizes and fires hook

**`streaming-handler.test.ts`:**

- Iterates stream chunks, accumulates content correctly
- Accumulates thinking deltas separately
- Captures tool calls when present
- Fires `onThinking`, `onContent`, `onToolCalls` callbacks
- Fires `onError` callback on stream error
- Handles empty stream gracefully

**`conversation.test.ts`** (orchestration):

- `sendDirectRequest` returns content, retries on degeneracy, fails after 3 retries
- `sendUserMessage` orchestrates prompt assembly → LLM call → tool execution → recursion
- `beginStreaming` orchestrates prompt assembly → streaming → tool execution → loop
- Taint tracking persists across turns
- `maybeRequestTitle` returns title on 10+ turns, returns undefined within 10 turns

### Integration tests (existing, remain unchanged)

- `src/plugins/system/web-ui/web-ui.test.ts` (1019 lines) — exercises the full PATCH handler pipeline which uses `beginStreaming` + `executeToolCalls`
- `src/lib/agent-system.test.ts` (535 lines) — exercises `runAgentLoop` which uses `sendUserMessage`
- Voice plugin tests — exercise `sendUserMessage` in voice context

### Manual testing steps

1. `npm run build` — no TypeScript errors
2. `npm start` — startup greeting works (exercises `sendUserMessage()`)
3. Open web UI — new chat greeting works, send a message that triggers tool calls, verify streaming works
4. Voice wake word — verify voice path still works end-to-end
5. Task assistant — create a task assistant interaction and verify handback
6. `npm run lint` — clean

## Definition of Done

- [ ] All 21 existing tests in `conversation.test.ts` pass after migration to new location
- [ ] All new sub-module tests pass (`degeneracy-check`, `prompt-assembler`, `tool-executor`, `context-manager`, `streaming-handler`)
- [ ] `npm test` passes with zero failures
- [ ] `npm run lint` passes with zero warnings/errors
- [ ] `npm run build` completes without TypeScript or bundling errors
- [ ] `npm start` produces startup greeting without errors
- [ ] `Conversation` public API surface (all public methods, all public properties) is unchanged from caller perspective
- [ ] `lib.ts` re-exports `Conversation`, `Message`, `ConversationStreamingCallbacks`, `StartConversationOptions`, `startConversation`, `checkLLMResponseForDegeneracy`, `SUMMARY_HEADER`
- [ ] `handleToolCalls` and `executeToolCalls` no longer contain duplicated tool dispatch logic — both delegate to `executeTools()`
- [ ] `sendUserMessage` and `beginStreaming` no longer contain duplicated prompt assembly — both call `assembleFullContext()`
- [ ] Conversation is under 250 lines (excluding imports/type re-exports)

## Risks & Mitigations

| Risk                                                                                                                               | Impact                                             | Mitigation                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Circular import between `conversation.ts` and `context-manager.ts` (both reference each other)                                     | Build failure                                      | `ConversationContextManager` references `Conversation` by its public interface only (the types it needs are in `types.ts`). `Conversation` instantiates and holds `ConversationContextManager`. No circular dependency — one-way: Conversation → ContextManager. |
| `maybeCompactContext` depends on `this.llmConnection` which is private                                                             | Tight coupling                                     | Pass `llmConnection` (or just the Ollama host/model/options) to `ConversationContextManager` constructor. Since the connection is read-only after construction, this is safe.                                                                                    |
| `compactContext('full')` and `closeConversation` call `Conversation.sendDirectRequest` statically                                  | Works but is implicit coupling                     | Accept `sendDirectRequest` as a constructor dependency on `ConversationContextManager`. This also improves testability by allowing injection of a mock summarizer.                                                                                               |
| External plugins access `conversation.rawContext` and `conversation.compactedContext` directly (voice-session-store, web-ui)       | Runtime errors if these aren't on the orchestrator | These fields remain public on `Conversation`. The orchestrator owns the arrays; `ConversationContextManager` reads/writes through the Conversation reference.                                                                                                    |
| `src/plugins/system/scratch-files/scratch-files-index.ts` imports `Conversation` and `Message` from `../../../lib/conversation.js` | Broken import if not updated                       | Covered in Step 8 file-change list.                                                                                                                                                                                                                              |
| ESM module caching in tests (same module singleton as noted in tool-call-events.test.ts)                                           | Tests may interfere with each other                | Each new sub-module test file imports its own subject. Module-level state (registries) lives in external modules (`tools.ts`, `tool-system.ts`). The refactoring doesn't add new module-level state. `vi.mock()` at top level continues to work.                 |

## Timeline Estimate

| Step      | Description                       | Estimated effort |
| --------- | --------------------------------- | ---------------- |
| 1         | Extract types                     | 15 min           |
| 2         | Extract degeneracy check + tests  | 30 min           |
| 3         | Extract prompt assembler + tests  | 45 min           |
| 4         | Extract context manager + tests   | 2 hours          |
| 5         | Extract tool executor + tests     | 1.5 hours        |
| 6         | Extract streaming handler + tests | 45 min           |
| 7         | Rebuild Conversation orchestrator | 1 hour           |
| 8         | Update all import paths           | 30 min           |
| 9         | Verify tests + lint + build       | 30 min           |
| **Total** |                                   | **~8 hours**     |

**Assumptions:**

- Existing test infrastructure (vitest, mocks) works as-is for new sub-modules
- No unexpected circular dependencies surface during extraction
- All callers continue to work without modification beyond import path updates
- The project conventions (`.js` extensions, kebab-case, co-located tests) are followed throughout
