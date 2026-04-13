# Plan: Tool Call Visibility in Web UI

## TL;DR

Make tool calls visible in the web UI by introducing a `ToolCallEvent` system in `Conversation.handleToolCalls()`, a new `tool_call` message kind in the web UI, and a real-time push channel (SSE) for streaming events during the synchronous PATCH. Design the event shape to support future permission gating by adding a `requiresApproval` flag on `Tool` definitions — but don't implement the blocking approval flow yet. Tool calls that execute in the same `Promise.all` batch are grouped visually in the UI via a `callBatchId`.

---

## Phase 1: Tool Call Event System (Core)

### Step 1.1: Define `ToolCallEvent` type

Add to `src/lib/tool-system.ts`:

```typescript
export type ToolCallEvent = {
  type: 'tool_call_started' | 'tool_call_completed' | 'tool_call_error';
  callBatchId: string; // UUID — groups tool calls from the same Promise.all batch
  toolName: string;
  toolArgs: Record<string, unknown>;
  conversationType: ConversationTypeId;
  sessionId?: number;
  taskAssistantId?: string;
  agentInstanceId?: string;
  // Populated on completed/error:
  resultSummary?: string;
  error?: string;
  timestamp: string; // ISO 8601
};
```

The `callBatchId` is generated once per `handleToolCalls()` depth iteration — all tool calls in the same `Promise.all` batch share the same `callBatchId`. This is the key grouping mechanism: the UI groups tool calls by batch, and the DB persists the batch ID so history renders them grouped too.

### Step 1.2: Add `requiresApproval` flag to `Tool` type

In `src/lib/tool-system.ts`, add optional field:

```typescript
export type Tool = {
  // ... existing fields ...
  /** If true, this tool requires user approval before execution. Not enforced yet — flag only. */
  requiresApproval?: boolean;
};
```

This is a no-op at runtime for now. It establishes the metadata slot so plugins can start declaring it and the UI can start rendering differently for approval-required tools.

### Step 1.3: Add tool call event callback registry

Add to `src/lib/tool-system.ts` (or a new `src/lib/tool-call-events.ts`):

```typescript
type ToolCallEventCallback = (event: ToolCallEvent) => Promise<void>;

const toolCallEventCallbacks: ToolCallEventCallback[] = [];

export const ToolCallEvents = {
  onToolCallEvent(callback: ToolCallEventCallback): void {
    toolCallEventCallbacks.push(callback);
  },
  async dispatchToolCallEvent(event: ToolCallEvent): Promise<void> {
    await Promise.all(toolCallEventCallbacks.map(cb => cb(event)));
  },
};
```

Pattern mirrors `AgentSystem.onUpdate()` — simple callback array, no hook lifecycle complexity.

### Step 1.4: Emit events from `Conversation.handleToolCalls()`

In `src/lib/conversation.ts`, modify the tool execution loop in `handleToolCalls()`:

- **Generate a `callBatchId`** (`randomUUID()`) at the top of each `handleToolCalls()` invocation, before the `Promise.all` loop. All tool calls in that batch share the same `callBatchId`.
- Before `tool.execute()`: dispatch `tool_call_started` event (with `callBatchId`)
- After successful `tool.execute()`: dispatch `tool_call_completed` event with `resultSummary` (truncated to ~200 chars) and `callBatchId`
- On error: dispatch `tool_call_error` event with `error` message and `callBatchId`

The `resultSummary` should be a truncated version of the result string (first 200 chars + "…" if longer). This keeps events lightweight for the SSE channel while the full result still goes to the LLM as before.

**Important**: Events are dispatched as fire-and-forget alongside the existing execution flow. They must NOT block or alter tool execution. Use `void dispatchToolCallEvent(...)` pattern to avoid awaiting in the hot path if needed, but since `Promise.all` is already used for parallel tool calls, awaiting within each tool's execution path is fine.

---

## Phase 2: Real-Time Push Channel (SSE)

### Step 2.1: Add SSE endpoint to web-ui

In `src/plugins/system/web-ui/web-ui.ts`, add a new endpoint:

```
GET /api/chat/:id/events
```

This is an SSE (Server-Sent Events) endpoint that:

- Keeps the connection open
- Sends `tool_call_started`, `tool_call_completed`, `tool_call_error` events as SSE `data` messages
- Includes an event type field so the client can distinguish them
- Closes when the session ends or the client disconnects

### Step 2.2: Wire `ToolCallEvents.onToolCallEvent` → SSE broadcast

In `web-ui.ts`, subscribe to `ToolCallEvents.onToolCallEvent` and:

- Filter events by `sessionId` matching the connected SSE client's session
- Forward matching events to the SSE response stream
- Format as SSE: `event: tool_call_started\ndata: {...}\n\n`

### Step 2.3: Session-scoped SSE connection management

Track active SSE connections per session. When a session is deleted/ended, close all its SSE connections. Use a simple `Map<sessionId, Set<Response>>`.

---

## Phase 3: Client-Side Tool Call Display

### Step 3.1: Extend `MessageKind` type

In `src/plugins/system/web-ui/client/types/index.ts`:

```typescript
export type MessageKind = 'chat' | 'notification' | 'tool_call';
```

### Step 3.2: Extend `Message` type for tool call data

```typescript
export interface ToolCallData {
  callBatchId: string; // groups tool calls from the same Promise.all batch
  toolName: string;
  status: 'running' | 'completed' | 'error';
  resultSummary?: string;
  error?: string;
  requiresApproval?: boolean;
}

export interface Message {
  role: MessageRole;
  messageKind: MessageKind;
  content: string;
  timestamp: string;
  senderName?: string | null;
  toolCallData?: ToolCallData; // present when messageKind === 'tool_call'
}
```

### Step 3.3: Add SSE hook (`useToolCallEvents`)

New file `src/plugins/system/web-ui/client/hooks/useToolCallEvents.ts`:

- Opens SSE connection to `/api/chat/:id/events` when a session is active
- Listens for `tool_call_started`, `tool_call_completed`, `tool_call_error` events
- Maintains a `Map<callBatchId, ToolCallData[]>` — groups incoming events by `callBatchId`
- On `tool_call_started`: add entry to the batch's array with `status: 'running'`
- On `tool_call_completed`: update the matching entry (by `toolName` within the batch) to `status: 'completed'` with `resultSummary`
- On `tool_call_error`: update the matching entry to `status: 'error'` with `error`
- Returns `{ toolCallBatches: Map<string, ToolCallData[]> }` for the current processing cycle
- Clears all batches when `isProcessing` transitions from true → false (processing complete)
- Cleans up SSE connection on session change or unmount

### Step 3.4: Create `ToolCallIndicator` component

New file `src/plugins/system/web-ui/client/components/ToolCallIndicator.tsx`:

- Renders a compact inline card showing:
  - Tool name (kebab-case → readable label)
  - Status icon: spinner for `running`, checkmark for `completed`, X for `error`
  - Expandable detail: arguments summary (from `toolArgs`), result summary on completed, error message on error
  - If `requiresApproval` is true, show a lock/shield icon (non-functional for now, just visual indicator)
- CSS class: `tool-call-indicator`, with status variants `--running`, `--completed`, `--error`

### Step 3.4.1: Batch status aggregation utility

New file `src/plugins/system/web-ui/client/utils/tool-call-batch.ts`:

Pure helper functions for batch-level status computation, testable in isolation:

```typescript
export type BatchStatus = 'running' | 'completed' | 'error';

export function getBatchStatus(calls: ToolCallData[]): BatchStatus {
  if (calls.some(call => call.status === 'running')) return 'running';
  if (calls.some(call => call.status === 'error')) return 'error';
  return 'completed';
}

export function getBatchHeaderLabel(
  calls: ToolCallData[],
  status: BatchStatus
): string {
  const count = calls.length;
  const isSingle = count === 1;
  const name = isSingle
    ? humanizeToolName(calls[0].toolName)
    : `${count} tools`;

  if (status === 'running') return `Using ${name}…`;
  if (status === 'error') {
    const errorCount = calls.filter(c => c.status === 'error').length;
    return isSingle
      ? `Used ${name} — failed`
      : `Used ${name} — ${errorCount} failed`;
  }
  return `Used ${name}`;
}

export function humanizeToolName(toolName: string): string {
  return toolName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
```

This keeps the aggregation logic out of the component and easily unit-testable.

### Step 3.5: Create `ToolCallBatch` component

New file `src/plugins/system/web-ui/client/components/ToolCallBatch.tsx`:

- Receives `calls: ToolCallData[]` (all calls sharing the same `callBatchId`)
- Computes an **aggregate batch status** from its member calls:
  - `'running'` — if any call is `running`
  - `'error'` — if no call is `running` and at least one is `error`
  - `'completed'` — if all calls are `completed`
- Renders a visual group container with:
  - A subtle header reflecting the aggregate status:
    - Running: "Using 3 tools…" (count, pluralized) or "Using weather…" (single tool, name shown directly)
    - Completed: "Used 3 tools" / "Used weather" (past tense)
    - Error: "Used 3 tools — 1 failed" / "Used weather — failed" (past tense + error count)
  - An aggregate status icon in the header: spinner (running), checkmark (completed), warning triangle (error)
  - Individual `ToolCallIndicator` components stacked inside the group
  - CSS class: `tool-call-batch`, with aggregate-status variants `--running`, `--completed`, `--error`
  - A left border or background tint to visually distinguish the group from surrounding messages
- Single-call batches render the tool name in the header directly instead of the count

### Step 3.6: Integrate into `MessagesArea`

In `MessagesArea.tsx`:

- Accept `toolCallBatches` from `useToolCallEvents` (via props or context)
- Show `ToolCallBatch` components between the `ProcessingStatus` and the last user message
- Each batch renders its grouped `ToolCallIndicator` entries
- When processing completes (isProcessing → false), the real-time tool call batches are replaced by the persisted `tool_call` messages in the message history

### Step 3.7: Integrate into `MessageBubble`

In `MessageBubble.tsx`:

- Add rendering for `messageKind === 'tool_call'` messages
- Use the same `ToolCallIndicator` component but in "history" mode (no spinner, just final status)
- Add `message--tool-call` CSS class

### Step 3.8: Group persisted `tool_call` messages in history

In `MessagesArea.tsx`, when rendering the `visibleMessages` list:

- Detect consecutive `tool_call` messages sharing the same `callBatchId`
- Wrap them in a `ToolCallBatch` component (same grouping component used for real-time display)
- This ensures history renders tool calls as grouped batches, matching the real-time display
- Implementation: iterate `visibleMessages`, collect runs of same-`callBatchId` `tool_call` messages, render each run as a `ToolCallBatch`

---

## Phase 4: Persist Tool Call Messages to DB

### Step 4.1: Extend `ChatSessionRound.messageKind`

In `src/plugins/system/web-ui/db-schemas/ChatSessionRound.ts`:

```typescript
messageKind: p.enum(['chat', 'notification', 'tool_call']).nullable().default('chat'),
```

### Step 4.2: Add `toolCallData` column to `ChatSessionRound`

Add a nullable JSON column:

```typescript
toolCallData: p.json().nullable().default(null),
```

This stores the `ToolCallData` object for `tool_call` messages. The `callBatchId` inside `toolCallData` is what the client uses to group persisted tool calls into batches.

### Step 4.3: Persist tool call events as messages

In `web-ui.ts`, subscribe to `ToolCallEvents.onToolCallEvent` and for each event:

- Create a `ChatSessionRound` with `role: 'assistant'`, `messageKind: 'tool_call'`, and the `toolCallData` JSON (including `callBatchId`)
- The `content` field stores a human-readable summary like "Called weather with {location: 'Portland'}"
- Only persist `tool_call_completed` and `tool_call_error` events (not `tool_call_started`, since the started state is transient and only relevant for real-time display)
- All tool calls from the same batch share the same `callBatchId` in their `toolCallData`, so the client can reconstruct the grouping from history

### Step 4.4: Serialize `toolCallData` in API responses

Update `serializeRound()` in `web-ui.ts` to include `toolCallData` in the response when present.

### Step 4.5: Filter tool call messages from LLM context

In `persistUnsynchronizedMessages()`, tool_call messages are persisted to DB but NOT appended to the `Conversation` object's context. They are UI-only records. The LLM never sees them — it already has the tool results in its system messages.

---

## Phase 5: Re-exports and Public API

### Step 5.1: Export `ToolCallEvents` from `lib.ts`

Add `ToolCallEvents` and `ToolCallEvent` type to the public API surface so plugins can subscribe to tool call events.

### Step 5.2: Update `PluginCapabilities['web-ui']`

No changes needed — the SSE endpoint is automatic. Plugins that want to react to tool calls should use `ToolCallEvents.onToolCallEvent()` directly.

---

## Relevant Files

- `src/lib/tool-system.ts` — Add `ToolCallEvent` type (with `callBatchId`), `requiresApproval` flag on `Tool`, `ToolCallEvents` registry
- `src/lib/conversation.ts` — Generate `callBatchId` per `handleToolCalls()` depth, emit `ToolCallEvent` from execution loop
- `src/plugins/system/web-ui/web-ui.ts` — SSE endpoint, event subscription, persist tool_call messages, serialize toolCallData
- `src/plugins/system/web-ui/db-schemas/ChatSessionRound.ts` — Add `tool_call` to messageKind enum, add `toolCallData` JSON column
- `src/plugins/system/web-ui/client/types/index.ts` — Extend `MessageKind`, add `ToolCallData` type (with `callBatchId`), extend `Message`
- `src/plugins/system/web-ui/client/hooks/useToolCallEvents.ts` — New SSE hook with batch grouping
- `src/plugins/system/web-ui/client/components/ToolCallIndicator.tsx` — New component (single tool call)
- `src/plugins/system/web-ui/client/components/ToolCallBatch.tsx` — New component (grouped tool calls)
- `src/plugins/system/web-ui/client/utils/tool-call-batch.ts` — New utility (batch status aggregation, header labels, tool name humanization)
- `src/plugins/system/web-ui/client/components/MessagesArea.tsx` — Integrate real-time tool call batches + group persisted tool_call messages
- `src/plugins/system/web-ui/client/components/MessageBubble.tsx` — Render `tool_call` message kind
- `src/lib.ts` — Re-export `ToolCallEvents` and `ToolCallEvent`

---

## Verification

1. **Unit tests**: Add tests for `ToolCallEvents` dispatch/subscribe in `src/lib/tool-system.test.ts` or new `src/lib/tool-call-events.test.ts`
2. **Unit tests**: Verify `callBatchId` is consistent across all events from the same `handleToolCalls()` depth iteration
3. **Integration test**: Send a chat message that triggers a tool call, verify `tool_call` messages appear in the session's API response with correct `toolCallData` (including `callBatchId`)
4. **Manual test**: Open web UI, send a message that triggers tool calls (e.g., weather), observe:
   - Real-time tool call indicators appear while processing
   - Multiple parallel tool calls appear grouped in a `ToolCallBatch` container
   - After response completes, tool call entries persist in message history, still grouped by batch
   - Tool call indicators show name + status (running → completed/error)
   - Expandable detail shows args and result summary
5. **SSE test**: Open browser DevTools Network tab, verify SSE connection opens to `/api/chat/:id/events` and events stream during tool execution
6. **DB migration test**: Verify existing sessions still load correctly after `ChatSessionRound` schema change (new nullable column + enum expansion)
7. **`requiresApproval` flag test**: Set `requiresApproval: true` on a test tool, verify the lock icon appears in the UI but execution still proceeds normally
8. **Grouping test**: Trigger a message that causes the LLM to call multiple tools in one response (e.g., weather + systemHealth), verify they appear in a single `ToolCallBatch` with the same `callBatchId`, both in real-time and in history
9. **Batch status aggregation test**: In a multi-tool batch, verify the batch header transitions correctly: "Using 2 tools…" (spinner) → "Used 2 tools" (checkmark) when both complete. Then test the error path: if one tool errors, verify the header shows "Used 2 tools — 1 failed" (warning triangle)
10. **Batch utility unit tests**: Test `getBatchStatus()`, `getBatchHeaderLabel()`, and `humanizeToolName()` in isolation — all combinations of running/completed/error across single and multi-call batches, edge cases (empty array, all errors, mixed completed+error)

---

## Decisions

- **SSE over WebSocket**: SSE is simpler, unidirectional (server→client), and sufficient for tool call events. WebSocket would be needed for bidirectional approval flow later, but SSE is the right starting point.
- **Fire-and-forget events**: Tool call events are observational. They must not alter the execution flow. The `requiresApproval` flag is metadata-only for now.
- **Persist completed/error only**: `tool_call_started` is transient real-time state. Only `tool_call_completed` and `tool_call_error` are persisted as history entries.
- **Tool call messages are UI-only**: They are NOT fed back into the LLM conversation context. The LLM already has tool results via system messages.
- **Result summary truncation at 200 chars**: Keeps events and DB records lightweight. Full results stay in the LLM context.
- **`requiresApproval` as opt-in flag**: Tools default to not requiring approval. This is additive — plugins opt in by setting the flag.
- **`callBatchId` as UUID per depth iteration**: Each `handleToolCalls()` invocation generates one `callBatchId`. All tool calls in that `Promise.all` batch share it. This naturally groups parallel tool calls without requiring the LLM or tools to know about grouping. Recursive calls at different depths get different batch IDs, which is correct — they are separate LLM turns.
- **`ToolCallBatch` as the primary visual unit**: Rather than scattering individual `ToolCallIndicator` components, the `ToolCallBatch` wrapper is the thing inserted into the message stream. This mirrors how the LLM actually reasons — "I need to call these tools together."
- **Batch-level status aggregation**: The `ToolCallBatch` component derives an aggregate status from its member calls — `'running'` if any call is running, `'error'` if none are running and at least one errored, `'completed'` if all completed. This is a pure UI-level computation (a helper function inside the component), not stored in the data model. The aggregate status drives the header text ("Using…" vs "Used…" vs "Used — N failed") and the header icon (spinner / checkmark / warning triangle).

---

## Further Considerations

1. **Approval flow design**: When implementing the blocking approval flow later, the SSE channel will need to become bidirectional (or a separate REST endpoint for approval responses). The `tool_call_started` event will become the hook point where execution pauses. The `ToolCallEvents` callback shape supports this — a callback can return a promise that resolves when approval is granted, effectively blocking execution. This is the natural extension point. The `callBatchId` will be important here: if any tool in a batch requires approval, the entire batch should be held until the user responds.
2. **Streaming LLM tokens**: The current PATCH endpoint blocks until the full LLM response. If token-level streaming is added later, the SSE channel could also stream partial assistant messages, making the "Alice is thinking" indicator more informative.
