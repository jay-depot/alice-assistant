# Implementation Plan: Streaming Output & Reasoning Display for Web UI

## Overview

Transition the web UI chat from a single request/response model to token-by-token streaming, leveraging Ollama's native streaming API. For thinking-capable models (e.g. Qwen3), display a real-time collapsible "thinking" block above the assistant's final answer. Tool calls continue to be rendered inline: the assistant's text streams until a tool call is detected, then the tool call batch renders, then the final answer streams.

Voice, compaction/summary generation, and other background LLM calls remain on the existing request/response path.

## Requirements Summary

### Functional Requirements

- FR1: The web UI's main chat endpoint (`PATCH /api/chat/:id`) streams assistant response tokens over the existing WebSocket connection instead of waiting for a complete HTTP response.
- FR2: If the model emits `thinking` tokens (Ollama `chunk.message.thinking`), these are relayed to the browser in real time.
- FR3: The browser renders `thinking` tokens in a collapsible panel above the streaming answer. The panel auto-expands while thinking tokens arrive and auto-collapses when the final `content` tokens begin.
- FR4: If the streamed response terminates with `tool_calls`, streaming pauses, the tool calls execute inline (using the existing event system), and then the assistant's final answer after tool results streams in a second wave.
- FR5: The final assistant message (including any `thinking` text) is persisted to the database exactly once per turn.
- FR6: The `reasoning` field is persisted alongside the `content` field in `ChatSessionRound`.
- FR7: Other consumers of `Conversation` (voice, compaction, title requests, direct tool calls, task assistants, agents) continue to use the existing synchronous `sendUserMessage()` path without changes.

### Non-Functional Requirements

- NFR1: The change must not regress latency for non-streaming consumers.
- NFR2: The WebSocket message schema must remain versioned/compatible with the existing `WsServerMessage` union.
- NFR3: Streaming must be abortable if the client disconnects or the server shuts down.
- NFR4: The implementation must handle server failure mid-stream gracefully (partial answer is not recovered; acceptable for V1).
- NFR5: Token accumulation must be deterministic (no out-of-order chunks).

## Architecture & Design

### High-Level Data Flow

```
User types message
  → POST /api/chat/:id
  → Conversation.beginStreaming(chatCb, thinkingCb, toolCb)
  → Ollama.chat({ stream: true })
  → AbortableAsyncIterator<ChatResponse>

For each chunk:
  ├─ chunk.message.thinking  → WS { type: 'stream_thinking', sessionId, delta }
  ├─ chunk.message.content   → WS { type: 'stream_content',  sessionId, delta }
  └─ chunk.message.tool_calls→ WS { type: 'stream_tool_calls', sessionId, toolCalls }

Tool calls execute → existing ToolCallEvents system
Final answer resumes streaming after tool results are appended

On completion:
  → conversation.appendToContext({ role:'assistant', content, thinking, tool_calls })
  → persistUnsynchronizedMessages()
  → WS { type: 'stream_done', sessionId }
  → HTTP PATCH returns 200 with full session payload (existing behaviour)
```

### Component Breakdown

| Layer               | Components                                    | Responsibility                                                                                                          |
| ------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **LLM Client**      | `Conversation.beginStreaming()`               | Wraps `OllamaClient.chat({ stream: true })`, accumulates chunks, routes thinking/content/tool_calls to callbacks.       |
| **Web UI Server**   | `PATCH /api/chat/:id` handler                 | Calls `beginStreaming()` with callbacks that broadcast WS messages. Manages tool call pause/resume loop.                |
| **WebSocket Types** | `ws-types.ts`                                 | Extends `WsServerMessage` with `stream_thinking`, `stream_content`, `stream_tool_calls`, `stream_done`, `stream_error`. |
| **Frontend Hook**   | `useStreamingSession.ts` (new)                | Subscribes to stream WS events, maintains local `streamingContent`, `streamingThinking`, `isThinking` state.            |
| **Frontend UI**     | `MessageBubble.tsx` / new `ThinkingBlock.tsx` | Renders collapsible thinking block. Integrates streamed tokens into MessagesArea.                                       |
| **Database**        | `ChatSessionRound.ts` / MikroORM schema       | Adds `reasoning` (nullable string) column. Auto-migrates on startup via `orm.schema.update()`.                          |

### Data Model Changes

#### `ChatSessionRound` (MikroORM entity)

```typescript
const ChatSessionRoundSchema = defineEntity({
  name: 'ChatSessionRound',
  properties: {
    id: p.integer().primary(),
    chatSession: () => p.manyToOne(ChatSession).fieldName('rounds'),
    role: p.enum(['user', 'assistant', 'system']),
    messageKind: p
      .enum(['chat', 'notification', 'tool_call'])
      .nullable()
      .default('chat'),
    content: p.string(),
    reasoning: p.string().nullable().default(null), // NEW
    timestamp: p.datetime(),
    senderName: p.string().nullable().default(null),
    toolCallData: p.json().nullable().default(null),
  },
});
```

#### `WsServerMessage` additions

```typescript
export type WsServerMessage =
  | { type: 'tool_call_event'; sessionId: number; event: WsToolCallEvent }
  | { type: 'session_updated'; sessionId: number; session: WsSession }
  | { type: 'sessions_list_updated'; sessions: WsSessionSummary[] }
  | { type: 'ping' }
  // NEW vvv
  | { type: 'stream_thinking'; sessionId: number; delta: string }
  | { type: 'stream_content'; sessionId: number; delta: string }
  | { type: 'stream_tool_calls'; sessionId: number; toolCalls: ToolCall[] }
  | {
      type: 'stream_done';
      sessionId: number;
      finalContent: string;
      finalReasoning: string | null;
    }
  | { type: 'stream_error'; sessionId: number; error: string };
```

#### Client `Message` type extension

```typescript
export interface Message {
  role: MessageRole;
  messageKind: MessageKind;
  content: string;
  reasoning?: string | null; // NEW
  timestamp: string;
  senderName?: string | null;
  toolCallData?: ToolCallData;
}
```

### API Contracts

- `PATCH /api/chat/:id` remains the same REST contract. The response payload does **not** change; it still returns the full session JSON after the turn is complete.
- WebSocket messages are strictly additive. Older clients ignore unknown `type` values.
- The `stream_*` events are scoped to `sessionId` exactly like existing `tool_call_event` and `session_updated` messages.

## New Package Dependencies

None. `ollama@0.6.3` already exposes `AbortableAsyncIterator<ChatResponse>` when `stream: true`. No frontend packages are needed — streaming state is managed with `useState` / `useEffect` over the existing WebSocket hook.

## Project Structure

Existing conventions preserved:

- `src/lib/conversation.ts` — Add `beginStreaming()` alongside `sendUserMessage()`.
- `src/plugins/system/web-ui/ws-types.ts` — Extend union type.
- `src/plugins/system/web-ui/db-schemas/ChatSessionRound.ts` — Add `reasoning` column.
- `src/plugins/system/web-ui/web-ui.ts` — Refactor `PATCH /api/chat/:id` to drive `beginStreaming()`.
- `src/plugins/system/web-ui/client/hooks/useStreamingSession.ts` — New hook (co-located with `useSession.ts`).
- `src/plugins/system/web-ui/client/components/ThinkingBlock.tsx` — New component.
- `src/plugins/system/web-ui/client/components/MessageBubble.tsx` — Accept optional `reasoning` prop.
- `src/plugins/system/web-ui/client/components/MessagesArea.tsx` — Render streaming state +ThinkingBlock.
- `src/plugins/system/web-ui/client/types/index.ts` — Add `reasoning` to `Message`.

## Implementation Steps

### Step 1 — Add `reasoning` field to DB entity and serialization

**Description:** Add `reasoning?: string | null` to `ChatSessionRound`. Update `serializeRound`, `buildWsSession`, and `persistUnsynchronizedMessages` to handle it. MikroORM's `orm.schema.update()` auto-applies on startup.
**Files:**

- `src/plugins/system/web-ui/db-schemas/ChatSessionRound.ts` — Add `reasoning` property.
- `src/plugins/system/web-ui/web-ui.ts` — Update `serializeRound` to include `reasoning: round.reasoning`; update `persistUnsynchronizedMessages` to persist `message.reasoning` if present.
  **Dependencies:** None.
  **Complexity:** Low.

### Step 2 — Add `beginStreaming()` to `Conversation`

**Description:** Add a new method `beginStreaming(options, callbacks)` on `Conversation`. It:

1. Calls `OllamaClient.chat({ ...getLLMConnection(), messages, tools, stream: true })`.
2. Iterates the `AbortableAsyncIterator<ChatResponse>`, accumulating `content` and `thinking`.
3. Invokes `onThinking(delta)`, `onContent(delta)`, `onToolCalls(toolCalls)` callbacks.
4. On completion, appends the full assistant `Message` (with `thinking` and `tool_calls`) to `this.rawContext` / `this.compactedContext` via `appendToContext()`.
5. Returns `{ content, thinking, toolCalls }`.
   **Files:**

- `src/lib/conversation.ts` — Add `beginStreaming()` method. Extract shared retry/connection setup into private helpers reused by `sendUserMessage()` and `beginStreaming()`.
- `src/lib/conversation.test.ts` — Add tests mocking `AbortableAsyncIterator`.
  **Dependencies:** Step 1 (for reasoning field in Message type if needed in context).
  **Complexity:** High.

### Step 3 — Extend WebSocket types and server-side broadcast helpers

**Description:** Extend `WsServerMessage` with the five new stream event types. Add a typed `broadcastStreamEvent(sessionId, event)` helper in `web-ui.ts` that piggy-backs on the existing `broadcastWs` closure.
**Files:**

- `src/plugins/system/web-ui/ws-types.ts` — Add new union members.
- `src/plugins/system/web-ui/web-ui.ts` — Add `broadcastWs` usage for stream events.
  **Dependencies:** None.
  **Complexity:** Low.

### Step 4 — Refactor `PATCH /api/chat/:id` to use streaming

**Description:** Replace the single `sendUserMessage()` call inside `runSessionOperation` with a streaming loop using `beginStreaming()`:

- When `onThinking(delta)` fires → `broadcastWs({ type: 'stream_thinking', sessionId, delta })`.
- When `onContent(delta)` fires → same for `stream_content`.
- When `onToolCalls(toolCalls)` fires → `broadcastWs({ type: 'stream_tool_calls', ... })`, then execute the existing tool call pipeline (`handleToolCalls` logic or inline equivalent), broadcast tool call events as today, append results to the `Conversation`, and call `beginStreaming()` again for the continuation turn.
- On final completion → append to context, persist, `broadcastWs({ type: 'stream_done', ... })`, then return the session payload in the HTTP response.
- On error → `broadcastWs({ type: 'stream_error', ... })`, throw to propagate 500.

**Key constraint:** The conversation must still be wrapped in `runSessionOperation` to prevent concurrent turns. The entire streaming lifecycle (including tool call pauses) happens inside the queued operation.

**Files:**

- `src/plugins/system/web-ui/web-ui.ts` — Refactor internal `sendUserMessage()` call site inside `PATCH /api/chat/:id`.
  **Dependencies:** Steps 2, 3.
  **Complexity:** High.

### Step 5 — Frontend: Create `useStreamingSession` hook

**Description:** A new hook that wraps or extends `useSession` with streaming state:

- Maintains `streamingContent: string`, `streamingThinking: string | null`, `isThinking: boolean`, `showThinking: boolean`.
- Subscribes to `stream_thinking`, `stream_content`, `stream_tool_calls`, `stream_done`, `stream_error` via `useWebSocket()`.
- Appends the final streamed message to the local `messages` array on `stream_done`.
- Clears streaming state on `stream_done` or `stream_error`.
- Resets state when `currentSessionId` changes.
  **Files:**
- `src/plugins/system/web-ui/client/hooks/useStreamingSession.ts`
- `src/plugins/system/web-ui/client/hooks/useStreamingSession.test.ts`
  **Dependencies:** Step 3.
  **Complexity:** Medium.

### Step 6 — Frontend: Render thinking block and streamed tokens

**Description:**

- Create `ThinkingBlock.tsx`: collapsible container with `max-height` and `overflow-y: auto`. While `isThinking` is true it auto-scrolls to bottom. When `isThinking` becomes false it collapses with a CSS transition. Toggles open/closed on click.
- Update `MessageBubble.tsx`:
  - If `message.reasoning` is present, render `<ThinkingBlock>` above the markdown bubble.
  - While a message is actively streaming (`timestamp === ''`), render the same thinking block from hook state.
- Update `MessagesArea.tsx`:
  - Accept new props from `useStreamingSession`.
  - Render a transient assistant message bubble (with thinking block) when `streamingContent` or `streamingThinking` is non-empty, **before** the existing `ProcessingStatus` spinner.
  - Ensure auto-scroll includes the growing streamed bubble.
    **Files:**
- `src/plugins/system/web-ui/client/components/ThinkingBlock.tsx`
- `src/plugins/system/web-ui/client/components/MessageBubble.tsx`
- `src/plugins/system/web-ui/client/components/MessagesArea.tsx`
- `src/plugins/system/web-ui/client/App.tsx` — Wire new props.
  **Dependencies:** Steps 5.
  **Complexity:** Medium.

### Step 7 — Frontend styling

**Description:** Add CSS for `.thinking-block`, `.thinking-block--expanded`, `.thinking-block--collapsed`, `.thinking-block__content`. Ensure dark-mode compatibility via existing CSS custom properties. Keep the block visually distinct (lighter background, monospaced font) so it doesn't look like the final answer.
**Files:**

- `src/plugins/system/web-ui/client/styles.css` (or existing stylesheet).
  **Dependencies:** Step 6.
  **Complexity:** Low.

### Step 8 — Integration tests and edge-case hardening

**Description:**

- Test that `beginStreaming()` accumulates thinking + content correctly.
- Test that tool calls pause and resume streaming.
- Test that `stream_error` broadcasts and the UI discards transient state.
- Test that voice and compaction paths are untouched (they still call `sendUserMessage()`).
- Test DB round-trip: `reasoning` is stored and returned on page reload.
  **Files:**
- `src/lib/conversation.test.ts`
- `src/plugins/system/web-ui/web-ui.test.ts`
- `src/plugins/system/web-ui/client/hooks/useStreamingSession.test.ts`
  **Dependencies:** Steps 1–6.
  **Complexity:** High.

## File Changes Summary

| File                                                                 | Action | Description                                                                    |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `src/lib/conversation.ts`                                            | Modify | Add `beginStreaming()`; refactor shared helpers.                               |
| `src/lib/conversation.test.ts`                                       | Modify | Tests for streaming accumulation, tool call pause/resume.                      |
| `src/plugins/system/web-ui/db-schemas/ChatSessionRound.ts`           | Modify | Add `reasoning` property.                                                      |
| `src/plugins/system/web-ui/ws-types.ts`                              | Modify | Add 5 new stream event types to `WsServerMessage`.                             |
| `src/plugins/system/web-ui/web-ui.ts`                                | Modify | Refactor `PATCH /api/chat/:id` to stream; broadcast events; persist reasoning. |
| `src/plugins/system/web-ui/web-ui.test.ts`                           | Modify | Update route handler tests for streaming WS events.                            |
| `src/plugins/system/web-ui/client/types/index.ts`                    | Modify | Add `reasoning?: string \| null` to `Message`.                                 |
| `src/plugins/system/web-ui/client/hooks/useStreamingSession.ts`      | Create | New hook for streaming state management.                                       |
| `src/plugins/system/web-ui/client/hooks/useStreamingSession.test.ts` | Create | Unit tests for hook state transitions.                                         |
| `src/plugins/system/web-ui/client/components/ThinkingBlock.tsx`      | Create | Collapsible real-time reasoning display.                                       |
| `src/plugins/system/web-ui/client/components/MessageBubble.tsx`      | Modify | Render `reasoning` via `ThinkingBlock`.                                        |
| `src/plugins/system/web-ui/client/components/MessagesArea.tsx`       | Modify | Wire streamed content + thinking into render tree.                             |
| `src/plugins/system/web-ui/client/App.tsx`                           | Modify | Integrate `useStreamingSession` props into `ChatWorkspace`.                    |
| `src/plugins/system/web-ui/client/styles.css`                        | Modify | Styles for `.thinking-block` variants.                                         |

## Testing Strategy

### Unit Tests

- `conversation.test.ts`:
  - Mock `ollama.chat({ stream: true })` returning an async generator yielding `ChatResponse` chunks with `thinking`, `content`, and `tool_calls`.
  - Assert callbacks fire in order, accumulated text matches final result, and `appendToContext` receives both `content` and `thinking`.
  - Assert that when `tool_calls` appear mid-stream, the method returns (or delegates) so the caller can execute tools and restart.

### Integration Tests

- `web-ui.test.ts`:
  - Assert `PATCH /api/chat/:id` broadcasts `stream_content` and `stream_done` WS messages.
  - Assert that `stream_tool_calls` is broadcast before existing `tool_call_event` messages.
  - Assert the HTTP response still contains the full session payload.

### Frontend Tests

- `useStreamingSession.test.ts`:
  - Simulate WS events and assert `streamingContent`, `streamingThinking`, `isThinking` transitions.
  - Assert `stream_done` appends a complete `Message` to the local messages array.

### Manual Testing Steps

1. Load the web UI, open DevTools → Network → WS.
2. Send "Hello". Verify `stream_content` chunks arrive, `stream_done` closes the turn, and the message appears in the chat.
3. Send a question that triggers a tool call (e.g. "What's my IP?" if a tool exists). Verify text streams, pauses, tool call batch renders, then final answer streams.
4. Run with a thinking-capable model (Qwen3). Verify the thinking block appears, auto-scrolls, and collapses when content begins.
5. Refresh the page. Verify persisted messages show a "show reasoning" toggle on assistant messages that had thinking.
6. Verify voice plugin still works (uses `sendUserMessage()`, no streaming). Press the voice hotkey and confirm a response arrives.

## Definition of Done

- [ ] `Conversation.beginStreaming()` exists and is covered by unit tests.
- [ ] `PATCH /api/chat/:id` sends `stream_thinking`, `stream_content`, `stream_tool_calls`, `stream_done`, and `stream_error` WS events scoped to the correct `sessionId`.
- [ ] The web UI renders incoming assistant tokens in real time.
- [ ] A collapsible "thinking" block appears above the answer when `thinking` tokens are emitted. It auto-scrolls and collapses when `content` tokens begin.
- [ ] Tool calls pause streaming, render inline, and resume with the final answer.
- [ ] The final assistant message is persisted to the DB with both `content` and `reasoning`.
- [ ] On page reload, persisted reasoning is visible via a toggle in `MessageBubble`.
- [ ] Voice, compaction/summary, and title request paths continue to use synchronous `sendUserMessage()` and are verified by existing tests passing.
- [ ] `npm run lint` and `npm test` pass.

## Risks & Mitigations

| Risk                                                                                                      | Impact                                                          | Mitigation                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ollama streaming iterator yields chunks with both `thinking` and `content` simultaneously or interleaved. | Medium — could corrupt UI state if not accumulated carefully.   | Accumulate both fields independently; emit `stream_thinking` only when `thinking` changes, `stream_content` only when `content` changes.                                                  |
| Tool calls appear in the _last_ chunk of a stream rather than as an atomic separate response.             | Medium — complicates pause/resume logic.                        | Treat any chunk with `tool_calls` as the signal to stop text accumulation and enter tool execution. Accumulate any trailing `content` before the tool_calls chunk as the "pre-tool" text. |
| Streaming introduces back-pressure if the client is slow.                                                 | Low — WS buffers in Node.js.                                    | Keep chunks small (<1 KB each) and rely on Node.js TCP back-pressure. The iterator is pull-based (`for await`), so natural back-pressure exists.                                          |
| Concurrent streaming turns on the same session.                                                           | High — violates existing `runSessionOperation` queue semantics. | Do **not** change the queue model. The entire streaming lifecycle (including tool call pauses) happens inside one `runSessionOperation` callback.                                         |
| Mid-stream server crash loses the partial response.                                                       | Low (acceptable for V1).                                        | Future work: write a transient "stream buffer" row to the DB on every chunk and recover on restart. Out of scope for this plan.                                                           |

## Timeline Estimate

| Phase               | Tasks                                          | Estimate         |
| ------------------- | ---------------------------------------------- | ---------------- |
| Backend foundation  | Steps 1–3 (DB field, beginStreaming, WS types) | 4–5 hours        |
| Backend integration | Step 4 (refactor PATCH handler for streaming)  | 5–6 hours        |
| Frontend streaming  | Steps 5–7 (hook, components, styling)          | 5–6 hours        |
| Testing & polish    | Step 8 (tests, manual QA, edge cases)          | 4–5 hours        |
| **Total**           |                                                | **~20–22 hours** |

Assumptions:

- Single developer with existing familiarity with the A.L.I.C.E. codebase.
- Ollama server available for manual testing with at least one model that supports `thinking` (Qwen3 or equivalent).
- No major schema migration issues (MikroORM `updateSchema` handles additive columns in SQLite).
