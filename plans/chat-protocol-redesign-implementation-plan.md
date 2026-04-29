# Implementation Plan: Chat Protocol Redesign

## Overview

Redesign the chat event protocol to eliminate the HTTP PATCH endpoint entirely, moving all chat operations onto the WebSocket. Fix the streaming→persisted bubble flicker, add multi-turn reasoning+tool-call block containers, preserve modal expanded state across message replacement, and address several secondary bugs discovered in the audit.

## Requirements Summary

### Functional

- **WS-first protocol**: Send messages, create sessions, and end sessions via WebSocket messages instead of HTTP endpoints
- **No bubble flicker**: The assistant's streaming response transitions seamlessly into the persisted message without visually disappearing
- **Multi-turn block containers**: Each LLM turn (reasoning → tool calls → next reasoning → ...) is wrapped in a collapsible container with individual collapsible reasoning/content blocks
- **Modal state preservation**: Opening "Open full message" on a streaming bubble preserves that expanded state when the response becomes a persisted message
- **"Invalid Date" hidden**: Pending/streaming message bubbles with empty timestamps don't show "Invalid Date"

### Bug Fixes

- **Read receipt "sent" state**: Currently skips directly from nothing to "read" due to timestamp key mismatch; fix to show "sent" → "read" progression
- **`useToolCallEvents.handleEvent` type**: Currently accepts `MessageEvent` but is called with `{data: string}` cast — fix to use `WsToolCallEvent` directly
- **Dedup effect ordering**: The tool-call-batch dedup effect runs after the clearing effect, making it ineffective during normal message completion

### Non-Functional

- Local-model-first, no cloud dependencies
- Must not break other WebSocket servers (stay on `registerWebSocket` API)
- Must preserve cross-tab sync
- Co-located tests

## Architecture & Design

### New Protocol Diagram

```
┌─ CLIENT ──────────────────────────────────────────────────────────────┐
│  AppShell                                                              │
│    ├── useSession                                                      │
│    │     ├── sendMessage → WS: send_message ──────────────────────────│
│    │     ├── handleNewChat → WS: create_session ──────────────────────│
│    │     └── deleteSession → WS: end_session ─────────────────────────│
│    │                                                                    │
│    ├── useStreamingSession ← WS: stream_thinking/content/tool_calls    │
│    │     ← WS: stream_turn_complete, stream_done                       │
│    │     state: StreamTurn[] (multi-turn blocks)                       │
│    │                                                                    │
│    ├── useToolCallEvents ← WS: tool_call_event                         │
│    │                                                                    │
│    └── MessagesArea                                                    │
│          owns: expandedMessageKeys (Set)                               │
│          renders: turns → StreamTurnContainer (collapsible)            │
│                   └── TurnReasoningBlock / TurnContentBlock            │
│                   └── tool call batches                                │
└────────────────────────────────────────────────────────────────────────┘
          │ WebSocket (single persistent connection)
          ▼
┌─ SERVER ──────────────────────────────────────────────────────────────┐
│  web-ui.ts                                                             │
│    wss.on('connection') → ws.on('message'):                           │
│      'send_message' → runSessionOperation(...)                        │
│      'create_session' → create + stream greeting                      │
│      'end_session' → archive session                                   │
│    Streaming loop broadcasts:                                          │
│      stream_thinking, stream_content, stream_tool_calls                │
│      stream_turn_complete (when tool calls exist between turns)       │
│      stream_done (final turn, no tool calls)                           │
│      session_updated (canonical state after completion)                │
│      sessions_list_updated (sidebar refresh)                           │
│    Errors:                                                             │
│      message_ack (confirms receipt)                                    │
│      message_error (processing failure)                                │
└────────────────────────────────────────────────────────────────────────┘
```

### WS Message Types — Client → Server

```typescript
type WsClientMessage =
  | { type: 'pong' }
  | {
      type: 'send_message';
      sessionId: number;
      content: string;
      clientMessageKey: string;
    }
  | { type: 'create_session' }
  | { type: 'end_session'; sessionId: number };
```

### WS Message Types — Server → Client (additions)

```typescript
// New types to add to WsServerMessage:
| { type: 'message_ack'; sessionId: number; clientMessageKey: string }
| { type: 'message_error'; sessionId: number; clientMessageKey: string; error: string }
| { type: 'stream_turn_complete'; sessionId: number; turnIndex: number; hasToolCalls: boolean }
| { type: 'session_created'; session: WsSession }
| { type: 'session_ended'; sessionId: number }
```

### StreamTurn Data Model (Client)

```typescript
interface StreamTurn {
  turnIndex: number; // 0-based, increments each beginStreaming call
  reasoning: string; // accumulated thinking content for this turn
  content: string; // accumulated regular content for this turn
  isComplete: boolean; // true when stream_turn_complete or stream_done fires for this turn
}

// In useStreamingSession state:
const [turns, setTurns] = useState<StreamTurn[]>([]);
const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
const [isStreaming, setIsStreaming] = useState(false);
```

### Expanded Message State (MessagesArea)

```typescript
// Track expanded state by identity key so it survives message replacement
const [expandedMessageKeys, setExpandedMessageKeys] = useState<Set<string>>(
  new Set()
);
```

## Removed HTTP Endpoints

| Endpoint               | Replacement         |
| ---------------------- | ------------------- |
| `PATCH /api/chat/:id`  | WS `send_message`   |
| `POST /api/chat`       | WS `create_session` |
| `DELETE /api/chat/:id` | WS `end_session`    |

`GET /api/chat/:id` and `GET /api/chat` remain for initial page load (before WS connects) and for the `reloadSession` fallback on error.

## Project Structure

All changes stay within existing file conventions. No new directories needed.

## Implementation Steps

### Step 1: Add new WS message types to `ws-types.ts`

**Files**: `src/plugins/system/web-ui/ws-types.ts`

Add the new server→client and client→server types:

```typescript
// Server → Client additions
| { type: 'message_ack'; sessionId: number; clientMessageKey: string }
| { type: 'message_error'; sessionId: number; clientMessageKey: string; error: string }
| { type: 'stream_turn_complete'; sessionId: number; turnIndex: number; hasToolCalls: boolean }
| { type: 'session_created'; session: WsSession }
| { type: 'session_ended'; sessionId: number }

// Client → Server (new type export)
export type WsClientMessage =
  | { type: 'pong' }
  | { type: 'send_message'; sessionId: number; content: string; clientMessageKey: string }
  | { type: 'create_session' }
  | { type: 'end_session'; sessionId: number };
```

Also export `WsToolCallEvent` explicitly (already defined, just need to ensure it's importable by the client).

**Complexity**: Low

**Dependencies**: None

---

### Step 2: Add `getMessageIdentityKey` utility

**Files**: `src/plugins/system/web-ui/client/utils.ts`

Add a timestamp-free identity function for message correlation:

```typescript
export function getMessageIdentityKey({
  role,
  content,
}: {
  role: string;
  content: string;
}): string {
  return `${role}:${content}`;
}
```

**Tests**: `src/plugins/system/web-ui/client/utils.test.ts` (create if not exists) — test collision behavior for identical content.

**Complexity**: Low

**Dependencies**: None

---

### Step 3: Rewrite `useStreamingSession` for multi-turn blocks

**Files**: `src/plugins/system/web-ui/client/hooks/useStreamingSession.ts`

Replace the current single-string accumulator with a `StreamTurn[]` array. The hook:

1. Subscribes to `stream_thinking`, `stream_content`, `stream_tool_calls`, `stream_turn_complete`, `stream_done`, `stream_error`
2. On `stream_thinking` / `stream_content`: appends delta to `turns[currentTurnIndex].reasoning` / `.content`
3. On `stream_turn_complete`: marks `turns[currentTurnIndex].isComplete = true`, increments `currentTurnIndex`, creates next turn slot
4. On `stream_done`: marks current turn complete, sets `finalContent` and `finalReasoning` from payload, stops streaming
5. On `stream_error`: marks current turn complete, stops streaming
6. Resets all state when `currentSessionId` changes or becomes null

Return interface:

```typescript
export interface StreamingState {
  turns: StreamTurn[]; // completed turns (excludes in-progress current turn)
  currentTurn: StreamTurn | null; // the turn currently receiving deltas (null when done)
  finalContent: string; // from stream_done payload (for handoff)
  finalReasoning: string | null; // from stream_done payload
  isStreaming: boolean;
  reset: () => void;
}
```

**Complexity**: High

**Dependencies**: Step 1 (new WS types)

---

### Step 4: Fix `useToolCallEvents` — type mismatch + dedup ordering

**Files**: `src/plugins/system/web-ui/client/hooks/useToolCallEvents.ts`

**4a. Type fix**: Change `handleEvent` to accept `WsToolCallEvent` directly instead of `MessageEvent`:

- Import `WsToolCallEvent` from `'../../ws-types.js'`
- Remove the local `ToolCallEvent` and `ToolCallEventType` interfaces
- Change signature: `(event: WsToolCallEvent) => void`
- Remove `JSON.parse(event.data)` — use `event` directly
- Update the WS subscription call to pass `msg.event` (already typed)
- Remove `as MessageEvent` cast

**4b. Effect ordering fix**: Swap the dedup and clearing effects so dedup runs first:

- Move the dedup effect (currently lines 152-173, depends on `[messages]`) ABOVE the clearing effect (currently lines 44-51, depends on `[isProcessing]`)
- Add comment documenting that order matters: "Must run before the clearing effect below so dedup happens before batch clearing on the same render pass"

**Complexity**: Medium

**Dependencies**: Step 1 (WsToolCallEvent export from ws-types.ts)

---

### Step 5: Fix read receipt via identity keys

**Files**:

- `src/plugins/system/web-ui/client/hooks/useSession.ts`
- `src/plugins/system/web-ui/client/components/MessagesArea.tsx`
- `src/plugins/system/web-ui/client/components/MessageBubble.tsx`

**5a. `useSession.ts`**: Change `pendingMessageKey` and `lastReadMessageKey` to use `getMessageIdentityKey` instead of `getMessageKey`:

- In `sendMessage`: `setPendingMessageKey(getMessageIdentityKey(optimisticMessage))`
- In `getLastReadMessageKey`: use `getMessageIdentityKey(message)` for finding the last read message
- In `applySessionState`: compute `lastReadMessageKey` from session messages using `getMessageIdentityKey`

**5b. `MessagesArea.tsx`**: Update receipt status comparison:

```typescript
receiptStatus={
  message.role === 'user'
    ? getMessageIdentityKey(message) === lastReadMessageKey
      ? 'read'
      : getMessageIdentityKey(message) === pendingMessageKey
        ? 'sent'
        : null
    : null
}
```

**Complexity**: Low

**Dependencies**: Step 2

---

### Step 6: Move expanded modal state to `MessagesArea`

**Files**:

- `src/plugins/system/web-ui/client/components/MessagesArea.tsx`
- `src/plugins/system/web-ui/client/components/MessageBubble.tsx`

**6a. `MessagesArea.tsx`**: Add state and pass to `MessageBubble`s:

```typescript
const [expandedMessageKeys, setExpandedMessageKeys] = useState<Set<string>>(new Set());

// When rendering MessageBubble:
<MessageBubble
  message={message}
  isExpanded={expandedMessageKeys.has(getMessageIdentityKey(message))}
  onToggleExpand={(key) => {
    setExpandedMessageKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }}
/>
```

This needs to apply to: persisted messages, pending assistant messages, and the streaming transient bubble. For the streaming bubble, use the identity key based on `streamingContent` (or `finalContent` after `stream_done`).

**6b. `MessageBubble.tsx`**: Replace internal `useState(false)` with props:

- Add `isExpanded?: boolean` and `onToggleExpand?: (key: string) => void` to props
- Remove internal `useState` for expansion
- When `onToggleExpand` exists, use it (parent-managed); otherwise fall back to internal state for backward compatibility
- Pass `getMessageIdentityKey(message)` as the key to `onToggleExpand`

**Complexity**: Medium

**Dependencies**: Step 2

---

### Step 7: Hide "Invalid Date" on empty timestamps

**Files**: `src/plugins/system/web-ui/client/components/MessageBubble.tsx`

In the `.message__meta` section, conditionally render the timestamp:

```typescript
<div className="message__meta">
  {message.timestamp ? <span>{formatTime(message.timestamp)}</span> : null}
  {/* receipt status remains unchanged */}
</div>
```

This hides the empty timestamp on pending assistant messages (line 174-182 of MessagesArea) and streaming bubbles (line 190-200), where `timestamp: ''`.

**Complexity**: Low

**Dependencies**: None

---

### Step 8: Server-side — Add WS client message handling

**Files**: `src/plugins/system/web-ui/web-ui.ts`

**8a. Incoming message router**: Inside `wss.on('connection', ws => { ... })`, replace the current minimal message handler with a typed router:

```typescript
ws.on('message', (data: Buffer) => {
  let msg: WsClientMessage;
  try {
    msg = JSON.parse(data.toString()) as WsClientMessage;
  } catch {
    return; // malformed, ignore
  }

  switch (msg.type) {
    case 'send_message':
      void handleSendMessage(ws, msg);
      break;
    case 'create_session':
      void handleCreateSession(ws);
      break;
    case 'end_session':
      void handleEndSession(ws, msg);
      break;
    case 'pong':
      // heartbeat — no action needed
      break;
    default:
      plugin.logger.warn(
        `Unknown WS client message type: ${(msg as { type: string }).type}`
      );
  }
});
```

**8b. `handleSendMessage`**: Contains the logic currently in `app.patch('/api/chat/:id')`, with these changes:

- Accepts `{sessionId, content, clientMessageKey}` from WS message
- Sends `message_ack` immediately on receipt
- On error (session not found, etc.): sends `message_error` with `clientMessageKey`
- The streaming loop adds `stream_turn_complete` broadcast after `beginStreaming` + persist when tool calls exist (see Step 9)
- After streaming completes: broadcasts `session_updated` (canonical state), then `sessions_list_updated`
- On error during processing: broadcasts `message_error`
- No longer sends an HTTP response — the `session_updated` broadcast IS the response

**8c. `handleCreateSession`**: Contains the logic currently in `app.post('/api/chat')`, with these changes:

- Creates the session, runs the greeting with `beginStreaming` (not `sendUserMessage`) so the greeting streams in
- After completion: broadcasts `session_created`, then `session_updated`, then `sessions_list_updated`

**8d. `handleEndSession`**: Contains the logic currently in `app.delete('/api/chat/:id')`:

- Runs the archive + delete logic
- Broadcasts `session_ended`, then `sessions_list_updated`

**8e. Remove the HTTP route handlers**: Delete `app.post('/api/chat', ...)`, `app.patch('/api/chat/:id', ...)`, and `app.delete('/api/chat/:id', ...)` from the `onAssistantAcceptsRequests` hook.

**Complexity**: High

**Dependencies**: Step 1 (new WS types), Step 9

---

### Step 9: Server-side — Add `stream_turn_complete` broadcast

**Files**: `src/plugins/system/web-ui/web-ui.ts`

In the streaming loop (currently inside `runSessionOperation`), add a `stream_turn_complete` broadcast after `persistUnsynchronizedMessages` when tool calls exist:

```typescript
while (true) {
  const turn = await llmTransaction.beginStreaming(callbacks, {
    depth: streamDepth,
  });
  await persistUnsynchronizedMessages(
    em,
    queuedSession,
    llmTransaction,
    'chat'
  );

  if (turn.toolCalls.length === 0) {
    broadcastWs({
      type: 'stream_done',
      sessionId: session.id,
      finalContent: turn.content,
      finalReasoning: turn.thinking || null,
    });
    break;
  }

  // Signal turn boundary so the client can wrap this turn's reasoning in a
  // collapsible block and prepare for the next turn.
  broadcastWs({
    type: 'stream_turn_complete',
    sessionId: session.id,
    turnIndex: streamDepth,
    hasToolCalls: true,
  });

  await llmTransaction.executeToolCalls(turn.toolCalls, streamDepth);
  streamDepth++;
}
```

`streamDepth` serves as the `turnIndex` — it starts at 0 and increments each time we execute tool calls and loop again.

**Complexity**: Low

**Dependencies**: Step 1

---

### Step 10: Client-side — Rewrite `useSession` to use WS for send/create/end

**Files**: `src/plugins/system/web-ui/client/hooks/useSession.ts`

**10a. `sendMessage`**: Replace `patchSession(currentSessionId, message)` HTTP call with WS send:

```typescript
const clientMessageKey = getMessageIdentityKey(optimisticMessage);

// Send via WebSocket
wsSend({
  type: 'send_message',
  sessionId: numericSessionId,
  content: message,
  clientMessageKey,
});

// State is updated by the WS subscription (session_updated),
// not by an HTTP response. Clear pending state on message_error.
```

The `wsSend` function is obtained from a new `useWebSocket` hook return value (see Step 10b).

The `sendMessage` function no longer awaits a response — it fires the WS message and lets the subscription-driven state updates handle the response. But it needs to handle the error case:

```typescript
// Track pending message keys that are awaiting acknowledgment
setPendingSendKeys(prev => new Set(prev).add(clientMessageKey));

// The WS subscription handles:
// 1. message_ack → confirm receipt
// 2. session_updated → apply final state (clears pendingSendKeys)
// 3. message_error → report error, reload session
```

Wait — actually, the current `sendMessage` function also handles the `isProcessingMessage` state, which disables the input. We still need that. Let me think about how to integrate the WS approach with the existing state machine.

The current flow:

1. `setIsProcessingMessage(true)`
2. `await patchSession()` → blocks until server responds
3. `applySessionState(response)`
4. `setIsProcessingMessage(false)` (in finally)

With WS:

1. `setIsProcessingMessage(true)`
2. Fire WS `send_message` → non-blocking
3. Don't await any response
4. The WS subscription fires `applySessionState` when `session_updated` arrives
5. `setIsProcessingMessage(false)` must happen when `session_updated` arrives

The problem: step 5 is tied to the WS subscription, not the `sendMessage` function. We need to wire `isProcessingMessage` to the WS flow.

Approach: Have the WS subscription (in the `useEffect` that subscribes to `session_updated`) also call `setIsProcessingMessage(false)` when it receives the update for the current session.

But what if the `session_updated` is from another tab? We'd incorrectly clear `isProcessingMessage`. We need correlation.

Better approach: have `sendMessage` set an "expected response" flag, and the WS subscription clears `isProcessingMessage` only when it receives a `session_updated` that matches. Track pending operations:

```typescript
const [pendingOperations, setPendingOperations] = useState<Set<string>>(
  new Set()
);

// In sendMessage:
setPendingOperations(prev => new Set(prev).add(clientMessageKey));

// In the session_updated subscription handler:
if (pendingOperations.size > 0) {
  // This update is for our pending operation — mark processing as done
  setIsProcessingMessage(false);
  setPendingOperations(new Set());
}
```

But there's still a race: `session_updated` could arrive from another tab while we're waiting. We need session-level versioning or a better protocol.

Simplest approach that works: have the server include a `correlationKey` in `session_updated` that echoes the `clientMessageKey` from the `send_message` that triggered it. But that means `session_updated` needs to carry per-connection correlation data, which breaks the broadcast model.

Alternative: On the server side, send the `session_updated` ONLY to the initiating connection (not broadcast), then send a separate `sessions_list_updated` broadcast for other tabs. This is cleaner:

```typescript
// In handleSendMessage on server:
// After streaming completes:
// 1. Send session_updated ONLY to the initiating ws connection
ws.send(JSON.stringify({ type: 'session_updated', sessionId, session }));
// 2. Broadcast sessions_list_updated to ALL connections for sidebar refresh
broadcastSessionsList();
```

But then other tabs don't get `session_updated` for the same session. They'll only get `sessions_list_updated` which is a summary — not the full message list. For cross-tab sync of message content, we'd need both connections polling or reloading.

Hmm, actually, looking at the current code more carefully, there's already logic in the `session_updated` WS subscription in `useSession` (line 264-283) that only applies updates when `msg.sessionId !== numericSessionId` — wait, actually it applies updates when they DO match. So `session_updated` is used to push updates TO the current tab for the active session. Other tabs should also see updates.

OK, let me take a simpler approach that keeps things working:

1. `sendMessage` sends WS message and sets `isProcessingMessage = true`
2. The WS subscription handles `stream_error` → report error, reload session, set `isProcessingMessage = false`
3. The WS subscription handles `session_updated` with matching `sessionId` → apply state AND set `isProcessingMessage = false`
4. On `message_error` → report error, set `isProcessingMessage = false`

The key insight: if another tab triggers a `session_updated` for our current session, applying it is fine (cross-tab sync), and clearing `isProcessingMessage` is also fine because we're not actually processing anything — we just loaded the update from another tab.

But there's still a subtle issue: if we're NOT processing (just viewing a session) and get a `session_updated` from another tab's activity, we'd still call `setIsProcessingMessage(false)`. But `false` → `false` is a no-op in React, so that's safe.

Actually wait, re-reading the current `useSession` code — `isProcessingMessage` starts as `false`. Another tab sends a message, we get `session_updated`, our subscription handler calls `applySessionState`, and then... we call `setIsProcessingMessage(false)` which is a no-op. That's correct.

But what about when WE send a message: `setIsProcessingMessage(true)`, fire WS, wait for `session_updated` to come back, subscription handler calls `applySessionState` AND `setIsProcessingMessage(false)`. But we need the handler to know this is OUR `session_updated` and not a concurrent one from another tab.

For now, the simplest approach: have the server broadcast `session_updated` to ALL connections (same as now). On the client, when `session_updated` arrives for our session:

```typescript
// In useSession's WS subscription useEffect:
if (msg.type === 'session_updated' && msg.sessionId === numericSessionId) {
  applySessionState(msg.session as unknown as Session);
  // Clear processing state — safe even if triggered by another tab
  setIsProcessingMessage(false);
  setPendingMessageKey(null);
}
```

This is slightly imperfect (another tab's update could "clear" our processing state early), but in practice:

- Two tabs sending messages to the same session simultaneously is extremely rare
- The `session_updated` from another tab would still correctly update our message list
- `isProcessingMessage` being cleared early just means the input re-enables sooner — not harmful

For a production-quality fix, we'd add correlation IDs, but that's scope creep for this plan.

**10b. `handleNewChat`**: Replace `createSession()` HTTP call with WS send:

```typescript
setIsSessionBusy(true);
wsSend({ type: 'create_session' });

// The session_created or session_updated WS message applies state
// and clears isSessionBusy.
```

**10c. `deleteSession`**: Replace `endSession(currentSessionId)` HTTP call with WS send:

```typescript
setIsEndingSession(true);
wsSend({ type: 'end_session', sessionId: currentSessionId });

// The session_ended WS message triggers state cleanup.
```

**10d. `useWebSocket` enhancement**: Add a `send` function:

```typescript
export function useWebSocket() {
  // ... existing connectWs, subscribe

  const send = useCallback((msg: WsClientMessage) => {
    if (currentWs && currentWs.readyState === WebSocket.OPEN) {
      currentWs.send(JSON.stringify(msg));
    } else {
      // Queue or warn — for now, log and skip
      console.warn('[ws] Cannot send — socket not open');
    }
  }, []);

  return { subscribe, send };
}
```

**10e. `handleEndSession` WS subscription**: Add handling for `session_ended`:

```typescript
if (msg.type === 'session_ended' && msg.sessionId === numericSessionId) {
  resetToWelcome();
  setIsEndingSession(false);
}
```

**Complexity**: High

**Dependencies**: Steps 1, 8, 9

---

### Step 11: Create `StreamTurnContainer` component

**Files**: `src/plugins/system/web-ui/client/components/StreamTurnContainer.tsx` (new)

A collapsible container that wraps a single LLM turn:

```typescript
interface StreamTurnContainerProps {
  turnIndex: number;
  reasoning: string;
  content: string;
  isComplete: boolean;
  isCurrent: boolean; // true for the turn currently receiving deltas
  isStreaming: boolean;
  toolCallBatch?: ToolCallData[]; // present when turn ended with tool calls
  expandedKeys: Set<string>;
  onToggleExpand: (key: string) => void;
}
```

Renders:

1. A header: "Thoughts" or "Turn N" with toggle arrow, status spinner (if current + streaming)
2. Collapsible reasoning block (when `reasoning` is non-empty): uses ThinkingBlock-like rendering, controlled by `expandedKeys`
3. Tool call batch (when `toolCallBatch` is present): uses ToolCallBatch
4. Content block (when `content` is non-empty and turn is complete): Markdown rendering
5. Auto-expands when `isCurrent && isStreaming`, auto-collapses when `isComplete`

**Complexity**: Medium

**Dependencies**: Steps 1, 3

---

### Step 12: Update `MessagesArea` rendering

**Files**: `src/plugins/system/web-ui/client/components/MessagesArea.tsx`

Replace the current four-section rendering (persisted messages → pending assistant → realtime batches → streaming bubble) with a unified approach:

1. **Welcome screen** (unchanged)
2. **Persisted messages** (unchanged grouping)
3. **Completed stream turns**: Render each completed turn from `turns` using `StreamTurnContainer`
4. **Current stream turn**: Render the in-progress turn using `StreamTurnContainer` with `isCurrent: true`
5. **Final content handoff** (after `stream_done`): Show the final assistant response as a regular `MessageBubble` using `finalContent`/`finalReasoning` from the streaming state — this replaces the old streaming transient bubble
6. **Processing/ending indicators** (unchanged)

The key for the final content handoff: after `stream_done`, the final turn's content should render as a regular (non-streaming) `MessageBubble`. The identity key `finalAssistant:${finalContent}` is used for the expanded state tracking, so if the user expanded the streaming view, the handoff bubble starts expanded too.

```typescript
// After stream turns, render final handoff:
{!isStreaming && finalContent ? (
  <MessageBubble
    message={{
      role: 'assistant',
      messageKind: 'chat',
      content: finalContent,
      reasoning: finalReasoning,
      timestamp: '', // transient — will be replaced by persisted version
    }}
    isExpanded={expandedMessageKeys.has(getMessageIdentityKey({
      role: 'assistant',
      content: finalContent,
    }))}
    onToggleExpand={(key) => {
      setExpandedMessageKeys(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }}
  />
) : null}
```

When `session_updated` arrives and `applySessionState` replaces `messages` (which includes the persisted assistant message with its server timestamp), the persisted `MessageBubble` renders with the same identity key, preserving the expanded state.

**Complexity**: High

**Dependencies**: Steps 3, 6, 11

---

### Step 13: Server-side — Handle `session_ended` broadcast for other handlers

**Files**: `src/plugins/system/web-ui/web-ui.ts`

After `handleEndSession` completes, broadcast:

```typescript
broadcastWs({ type: 'session_ended', sessionId });
void broadcastSessionsList();
```

Also in the cleanup during `onAssistantWillStopAcceptingRequests`, close connections before broadcasting (already handled).

**Complexity**: Low

**Dependencies**: Step 8

---

### Step 14: Update `useWebSocket` test mocks and existing tests

**Files**:

- `src/plugins/system/web-ui/web-ui.test.ts`
- `src/plugins/system/web-ui/client/utils.test.ts` (new or existing)
- `src/plugins/system/web-ui/client/utils/tool-call-batch.test.ts`
- Any test files for hooks (create if not exist)

**14a. Server test updates**: Update `web-ui.test.ts` to:

- Remove tests for `PATCH /api/chat/:id`, `POST /api/chat`, `DELETE /api/chat/:id`
- Add tests for the new WS message handlers (`send_message`, `create_session`, `end_session`)
- Mock the WS connection and verify `message_ack`, `message_error`, `session_updated`, `session_ended` broadcasts
- Verify `stream_turn_complete` is broadcast between turns
- Verify `GET /api/chat/:id` and `GET /api/chat` still work

**14b. Client utility tests**:

- Add test for `getMessageIdentityKey` — same content produces same key, different content produces different key
- Test `getMessageIdentityKey` for edge cases (empty content, very long content)

**14c. Hook tests**: If hook test files exist, update mocks to use WS sends instead of HTTP calls.

**Complexity**: Medium

**Dependencies**: All prior steps

---

### Step 15: Integration testing & manual verification

Manual verification checklist:

- [ ] Send a message → no bubble flicker
- [ ] Send a message that triggers tool calls → see reasoning block, then tool call batch, then next reasoning block, then final response, all in collapsible containers
- [ ] Open "Open full message" on a streaming response → persists when message becomes static
- [ ] Read receipt shows "Sent" then "Read" for user messages
- [ ] No "Invalid Date" on streaming/pending bubbles
- [ ] Create new session → greeting streams in
- [ ] End session → session archived, sidebar updates
- [ ] Two browser tabs → sending a message in one updates the other's message list
- [ ] Session reload on page refresh works (GET /api/chat/:id still functional)
- [ ] Error during message send → error toast shown, session reloads correctly
- [ ] WebSocket reconnect after disconnect → state resyncs

**Complexity**: Low (manual)

**Dependencies**: All prior steps

---

## File Changes Summary

| File                                                                  | Action        | Description                                                                                                                                                                                      |
| --------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/plugins/system/web-ui/ws-types.ts`                               | Modify        | Add `message_ack`, `message_error`, `stream_turn_complete`, `session_created`, `session_ended` to `WsServerMessage`; add `WsClientMessage` type; ensure `WsToolCallEvent` is explicitly exported |
| `src/plugins/system/web-ui/client/utils.ts`                           | Modify        | Add `getMessageIdentityKey` function                                                                                                                                                             |
| `src/plugins/system/web-ui/client/utils.test.ts`                      | Create/Modify | Tests for `getMessageIdentityKey`                                                                                                                                                                |
| `src/plugins/system/web-ui/client/hooks/useWebSocket.ts`              | Modify        | Add `send` function returning `WsClientMessage`                                                                                                                                                  |
| `src/plugins/system/web-ui/client/hooks/useStreamingSession.ts`       | Rewrite       | Multi-turn `StreamTurn[]` state, `stream_turn_complete` handling                                                                                                                                 |
| `src/plugins/system/web-ui/client/hooks/useToolCallEvents.ts`         | Modify        | Fix type to use `WsToolCallEvent`; swap dedup/clear effect order                                                                                                                                 |
| `src/plugins/system/web-ui/client/hooks/useSession.ts`                | Rewrite       | WS-based send/create/end; identity keys for receipts; error handling                                                                                                                             |
| `src/plugins/system/web-ui/client/hooks/useSessions.ts`               | Modify        | Remove `refreshSessions` after WS operations; rely on WS broadcasts                                                                                                                              |
| `src/plugins/system/web-ui/client/components/StreamTurnContainer.tsx` | Create        | New collapsible turn container component                                                                                                                                                         |
| `src/plugins/system/web-ui/client/components/MessagesArea.tsx`        | Modify        | Unified rendering with turns, final handoff; expanded message state                                                                                                                              |
| `src/plugins/system/web-ui/client/components/MessageBubble.tsx`       | Modify        | Props for `isExpanded`/`onToggleExpand`; hide timestamp when empty                                                                                                                               |
| `src/plugins/system/web-ui/client/components/InputArea.tsx`           | Modify        | No changes (interface unchanged)                                                                                                                                                                 |
| `src/plugins/system/web-ui/client/App.tsx`                            | Modify        | Wire new `useStreamingSession` return shape; pass expanded state                                                                                                                                 |
| `src/plugins/system/web-ui/client/api/sessions.ts`                    | Modify        | Remove `patchSession`, `createSession`, `endSession` exports; keep `fetchSession`, `fetchSessions`                                                                                               |
| `src/plugins/system/web-ui/web-ui.ts`                                 | Major rewrite | WS message router; remove PATCH/POST/DELETE HTTP routes; add `stream_turn_complete`                                                                                                              |
| `src/plugins/system/web-ui/web-ui.test.ts`                            | Major rewrite | WS handler tests; remove HTTP route tests                                                                                                                                                        |
| `src/plugins/system/web-ui/client/style.css`                          | Modify        | Add styles for `StreamTurnContainer`, turn content/reasoning blocks                                                                                                                              |

## Testing Strategy

### Unit Tests

- `getMessageIdentityKey`: identity matches for same role+content, differs for different content
- `useToolCallEvents`: type safety (no more `MessageEvent` cast), correct event dispatching
- Server WS handlers: correct response messages for each client message type

### Integration Tests

- Full send→ack→stream→session_updated cycle via mocked WS
- Multi-turn streaming with `stream_turn_complete` boundaries
- Error paths: session not found, LLM errors, WS disconnect mid-stream

### Manual Testing Steps

1. Start assistant with `npm run build && npm start`
2. Open two browser tabs to the web UI
3. Verify each item in the Definition of Done checklist

## Definition of Done

- [ ] Sending a message via WS produces `message_ack` immediately
- [ ] The assistant's response streams in without any visual "blink" between streaming and persisted states
- [ ] Multi-turn tool call flows show reasoning blocks in collapsible containers, with tool call batches visibly grouped
- [ ] Opening the "Open full message" modal on a streaming bubble preserves expanded state when the response becomes static (persisted message)
- [ ] "Invalid Date" does not appear on any streaming or pending message bubbles
- [ ] Read receipts show "Sent" when the user message is sent and "Read" after the assistant responds
- [ ] Creating a new session via WS streams the greeting and returns the session
- [ ] Ending a session via WS archives it and updates the sidebar
- [ ] `GET /api/chat/:id` and `GET /api/chat` still work for page reloads
- [ ] Cross-tab sync works: message sent in tab A appears in tab B's view
- [ ] All existing tests pass (after updates)
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds

## Risks & Mitigations

| Risk                                                               | Impact                                                      | Mitigation                                                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| WS send while not connected                                        | Message silently lost                                       | Log warning; user sees input re-enable when processing doesn't start → they retry                    |
| `session_updated` race between tabs clearing `isProcessingMessage` | Input re-enables slightly early in the initiating tab       | Low severity; no data loss; future enhancement: correlation IDs                                      |
| `StreamTurnContainer` CSS complexity                               | Layout may break on resize or very long reasoning blocks    | Start with simple flex layout; add max-height with overflow for reasoning                            |
| Removing HTTP endpoints breaks external integrations               | Any non-UI clients using the API break                      | The old endpoints were internal only (no documented API); check for any direct usage in test scripts |
| `beginStreaming` used for session creation greeting                | Greeting is non-streaming, suddenly streaming is observable | Intentional improvement — users see the greeting appear progressively                                |

## Timeline Estimate

| Step                               | Effort | Cumulative |
| ---------------------------------- | ------ | ---------- |
| 1. WS types                        | 0.5h   | 0.5h       |
| 2. getMessageIdentityKey           | 0.5h   | 1h         |
| 3. useStreamingSession rewrite     | 2h     | 3h         |
| 4. useToolCallEvents fixes         | 1h     | 4h         |
| 5. Read receipt fix                | 0.5h   | 4.5h       |
| 6. Expanded modal state            | 1h     | 5.5h       |
| 7. Invalid Date fix                | 0.25h  | 5.75h      |
| 8. Server WS message router        | 2h     | 7.75h      |
| 9. Server stream_turn_complete     | 0.25h  | 8h         |
| 10. useSession WS rewrite          | 2h     | 10h        |
| 11. StreamTurnContainer component  | 1.5h   | 11.5h      |
| 12. MessagesArea rendering update  | 1.5h   | 13h        |
| 13. Server session_ended broadcast | 0.25h  | 13.25h     |
| 14. Test updates                   | 2h     | 15.25h     |
| 15. Integration testing            | 1h     | 16.25h     |

**Total: ~2 days** (assuming familiarity with the codebase). Add 50% buffer for debugging = **~3 days**.

Assumptions: single developer, no external blockers, tests exist for current code and need updating rather than net-new test infrastructure.
