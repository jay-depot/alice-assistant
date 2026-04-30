# Implementation Plan: Web UI Plugin Refactor

## Overview

Split the 1,548-line `web-ui.ts` plugin registration into focused server-side modules that are individually readable, testable, and maintainable. The client-side code (hooks, components, utils) is already well-organized and will not be restructured. The refactor is purely a server-side file extraction — no behavior changes.

## Requirements Summary

- Extract server-side logic from `web-ui.ts` into separate files under `src/plugins/system/web-ui/`
- Preserve every existing behavior, API contract, and test expectation
- Consolidate the two `ToolCallEvents.onToolCallEvent` listeners into one
- Keep `plugin.offer<'web-ui'>` capabilities unchanged
- No changes to client-side code, WS message types, or DB schemas

## Architecture & Design

The existing `registerPlugin` closure creates dozens of functions that share captured state:

- `plugin` (plugin interface with `logger`, `hooks`, `offer`, `request`)
- `onDatabaseReady` (from memory plugin)
- `cachedChatConversations` (Map)
- `sessionOperationQueues` (Map)
- `pendingToolCallRounds` (Map)
- `broadcastWs` (late-bound function)
- `registeredScripts`, `registeredStylesheetPaths`, `stylesheetUrlsByGroup`
- `orm` (from `onAssistantAcceptsRequests`)

The extraction pattern: each extracted module exports a factory function that receives a **context object** containing the shared state it needs. The `index.ts` creates the context and passes it to each module during `registerPlugin`.

### Target file structure

```
web-ui/
  index.ts                   # Plugin entry — wires everything together
  context.ts                 # WebUiContext type + creation function
  lib/
    serialization.ts         # buildWsSession, serializeRound,
                             #   restoreConversationMessages,
                             #   serializeCompactedContext, restoreCompactedContext
    session-manager.ts       # Conversation caching, createEmptyChatSession,
                             #   queueAssistantMessageToSession,
                             #   resolveTargetChatSession, queueAssistantMessage,
                             #   queueAssistantInterruption, runSessionOperation
    db-persistence.ts        # persistUnsynchronizedMessages,
                             #   flushPendingToolCallRounds, flushCachedConversation,
                             #   closeAndEvictCachedConversation,
                             #   flushAndEvictAllCachedConversations
    extensions.ts            # registerScript, registerStylesheet, /api/extensions route
    ws-broadcast.ts          # broadcastWs setup, broadcastSessionsList, heartbeat
    ws-handlers.ts           # handleSendMessage, handleCreateSession,
                             #   handleEndSession, client message router
  routes/
    http-chat.ts             # GET /api/chat, GET /api/chat/:id,
                             #   POST /api/chat/:id/compact
    static.ts                # /user-style.css, static file serving, SPA catch-all
  ws-types.ts                # (unchanged)
  db-schemas/                # (unchanged)
  client/                    # (unchanged)
```

### Shared context type

```typescript
interface WebUiContext {
  plugin: RegisteredPlugin;
  onDatabaseReady: Memory['onDatabaseReady'];
  app: Express;
  logger: PluginLogger;
  cachedChatConversations: Map<number, Conversation>;
  sessionOperationQueues: Map<number, Promise<void>>;
  pendingToolCallRounds: Map<number, PendingToolCallRound[]>;
  broadcastWs: (msg: WsServerMessage) => void;
  registeredScripts: RegisteredUiExtension[];
  registeredScriptPaths: Set<string>;
  registeredStylesheetPaths: Set<string>;
  stylesheetUrlsByGroup: Map<string, string[]>;
  orm: MikroORM | null; // null until onAssistantAcceptsRequests fires
}
```

## Project Structure

All new server-side files go under `src/plugins/system/web-ui/`. No changes to imports in client-side files because the server module exports (via `lib.js`) remain unchanged.

Imports in the new modules follow project conventions:

- `import { ... } from '../../../lib.js'` for framework types/functions
- `import { ... } from './context.js'` for the shared context type
- `import type { ... } from './ws-types.js'` for WS message types
- Explicit `.js` extensions on all local/relative imports

## Implementation Steps

The steps are ordered by dependency: types/context first, then leaf modules, then the modules that compose them, finally the index file.

### Step 1: Create `context.ts`

- **Description**: Define the `WebUiContext` type shared by all extracted modules. Provide `createContext()` to build the initial state.
- **Files to create**: `src/plugins/system/web-ui/context.ts`
- **Dependencies**: None
- **Estimated complexity**: Low

```typescript
// context.ts — Shared state for all server-side web-ui modules
import type { PluginLogger } from '../../../lib.js';
import type { MikroORM } from '@mikro-orm/sqlite';
import type { Express } from 'express';
import type { WebSocket } from 'ws';
import type { WsServerMessage } from './ws-types.js';
import type { Conversation } from '../../../lib.js';
import type { AliceUiScriptRegistration } from '../../../lib.js';

export interface RegisteredUiExtension extends AliceUiScriptRegistration {
  groupKey: string;
}

export interface PendingToolCallRound {
  role: 'assistant';
  messageKind: 'tool_call';
  content: string;
  timestamp: Date;
  senderName: null;
  toolCallData: {
    callBatchId: string;
    toolName: string;
    status: 'completed' | 'error';
    resultSummary?: string;
    error?: string;
    requiresApproval?: boolean;
    taskAssistantId?: string;
    agentName?: string;
  };
}

export interface WebUiContext {
  logger: PluginLogger;
  onDatabaseReady: (
    cb: (orm: MikroORM) => Promise<MikroORM>
  ) => Promise<MikroORM>;
  app: Express;
  cachedChatConversations: Map<number, Conversation>;
  sessionOperationQueues: Map<number, Promise<void>>;
  pendingToolCallRounds: Map<number, PendingToolCallRound[]>;
  broadcastWs: (msg: WsServerMessage) => void;
  setBroadcastWs: (fn: (msg: WsServerMessage) => void) => void;
  registeredScripts: RegisteredUiExtension[];
  registeredScriptPaths: Set<string>;
  registeredStylesheetPaths: Set<string>;
  stylesheetUrlsByGroup: Map<string, string[]>;
  orm: MikroORM | null;
  setOrm: (orm: MikroORM) => void;
}

export function createContext(opts: {
  logger: PluginLogger;
  onDatabaseReady: WebUiContext['onDatabaseReady'];
  app: Express;
}): WebUiContext {
  return {
    logger: opts.logger,
    onDatabaseReady: opts.onDatabaseReady,
    app: opts.app,
    cachedChatConversations: new Map(),
    sessionOperationQueues: new Map(),
    pendingToolCallRounds: new Map(),
    broadcastWs: () => {},
    setBroadcastWs(fn) {
      this.broadcastWs = fn;
    },
    registeredScripts: [],
    registeredScriptPaths: new Set(),
    registeredStylesheetPaths: new Set(),
    stylesheetUrlsByGroup: new Map(),
    orm: null,
    setOrm(o) {
      this.orm = o;
    },
  };
}
```

### Step 2: Create `lib/serialization.ts`

- **Description**: Extract pure serialization functions that have no side effects and don't depend on context state (except DB entity types). These are the simplest to extract.
- **Files to create**: `src/plugins/system/web-ui/lib/serialization.ts`
- **Files to modify**: None yet
- **Dependencies**: None (depends only on `ws-types.ts` and `db-schemas/`)
- **Estimated complexity**: Low

Functions to extract:

- `restoreConversationMessages(rounds: ChatSessionRound[]): Message[]`
- `serializeCompactedContext(messages: Message[] | undefined)`
- `restoreCompactedContext(json: unknown): Message[] | undefined`
- `buildWsSession(session: ChatSession, sessionId: number, getActiveAgentsForSession: (sid: number) => WsActiveAgent[]): WsSession`
- `serializeRound(round: ChatSessionRound)`
- `getActiveAgentsForSession(sessionId: number): WsActiveAgent[]`

Note: `getActiveAgentsForSession` imports `AgentSystem` from `lib.js` — it is a standalone function, not a closure.

### Step 3: Create `lib/db-persistence.ts`

- **Description**: Extract database persistence functions. These take `WebUiContext` and entity references as parameters.
- **Files to create**: `src/plugins/system/web-ui/lib/db-persistence.ts`
- **Dependencies**: `context.ts`, `serialization.ts`, `db-schemas/`
- **Estimated complexity**: Medium

Functions to extract:

- `persistUnsynchronizedMessages(ctx, em, session, conversation, assistantMessageKind?, senderName?): Promise<void>`
- `flushPendingToolCallRounds(ctx, em, session): void`
- `flushCachedConversation(ctx, sessionId, assistantMessageKind?): Promise<boolean>`

### Step 4: Create `lib/session-manager.ts`

- **Description**: Extract session lifecycle management. Depends on DB persistence functions.
- **Files to create**: `src/plugins/system/web-ui/lib/session-manager.ts`
- **Dependencies**: `context.ts`, `db-persistence.ts`
- **Estimated complexity**: High

Functions to extract:

- `evictCachedConversation(ctx, sessionId): void`
- `getOrCreateCachedConversation(ctx, session): Conversation`
- `runSessionOperation(ctx, sessionId, operation): Promise<T>`
- `createEmptyChatSession(ctx, title?): Promise<number>`
- `queueAssistantMessageToSession(ctx, sessionId, message): Promise<void>`
- `resolveTargetChatSession(ctx, options): Promise<number | null>`
- `queueAssistantMessage(ctx, message): Promise<number | null>`
- `queueAssistantInterruption(ctx, interruption): Promise<number | null>`
- `closeAndEvictCachedConversation(ctx, sessionId): Promise<void>`
- `flushAndEvictAllCachedConversations(ctx): Promise<void>`

### Step 5: Create `lib/extensions.ts`

- **Description**: Extract UI extension registration (registerScript, registerStylesheet) and the `/api/extensions` route.
- **Files to create**: `src/plugins/system/web-ui/lib/extensions.ts`
- **Dependencies**: `context.ts`, `node:fs`, `node:crypto`, `node:path`
- **Estimated complexity**: Low

Functions to extract:

- `registerScript(ctx, scriptPath): void`
- `registerStylesheet(ctx, stylesheetPath): void`
- `addExtensionsRoute(ctx): void` (registers GET /api/extensions on ctx.app)

### Step 6: Create `lib/ws-broadcast.ts`

- **Description**: Extract WebSocket broadcast setup, heartbeat, and the sessions list broadcast helper.
- **Files to create**: `src/plugins/system/web-ui/lib/ws-broadcast.ts`
- **Dependencies**: `context.ts`, `ws-types.ts`, `db-schemas/`
- **Estimated complexity**: Medium

Functions to extract:

- `setupBroadcast(ctx): void` — wire up `broadcastWs` to broadcast to all connected WS clients
- `broadcastSessionsList(ctx): Promise<void>` — query all sessions and broadcast
- `startHeartbeat(ctx, wsConnections: Set<WebSocket>): NodeJS.Timeout`
- `sendInitialSessionsList(ctx, ws: WebSocket): Promise<void>` — send on connect

Note: `wsConnections` (the Set<WebSocket>) is created inside the `onAssistantAcceptsRequests` hook, not in the context. It gets passed explicitly.

### Step 7: Create `lib/ws-handlers.ts`

- **Description**: Extract the three WS message handlers. These are the largest and most complex functions.
- **Files to create**: `src/plugins/system/web-ui/lib/ws-handlers.ts`
- **Dependencies**: `context.ts`, `session-manager.ts`, `db-persistence.ts`, `ws-broadcast.ts`, `serialization.ts`
- **Estimated complexity**: High

Functions to extract:

- `handleSendMessage(ctx, ws, msg): Promise<void>`
- `handleCreateSession(ctx, ws): Promise<void>`
- `handleEndSession(ctx, ws, msg): Promise<void>`
- `createMessageRouter(ctx, wsConnections): (ws: WebSocket) => void` — the `wss.on('connection', ...)` handler

These functions need access to `ctx.orm` for forking entity managers. The `createMessageRouter` also handles the `ws.on('close')` / `ws.on('error')` cleanup and the initial sessions list send.

### Step 8: Create `routes/http-chat.ts`

- **Description**: Extract the HTTP routes for chat sessions (read + compact).
- **Files to create**: `src/plugins/system/web-ui/routes/http-chat.ts`
- **Dependencies**: `context.ts`, `session-manager.ts`, `serialization.ts`, `db-schemas/`
- **Estimated complexity**: Medium

Functions to extract:

- `registerChatRoutes(ctx): void` — registers GET /api/chat, GET /api/chat/:id, POST /api/chat/:id/compact

### Step 9: Create `routes/static.ts`

- **Description**: Extract static file serving routes.
- **Files to create**: `src/plugins/system/web-ui/routes/static.ts`
- **Dependencies**: `context.ts`, `node:fs`, `node:path`, `express`
- **Estimated complexity**: Low

Functions to extract:

- `registerStaticRoutes(ctx, currentDir: string): void` — registers /user-style.css, static file serving, SPA catch-all

### Step 10: Rewrite `web-ui.ts` → `index.ts`

- **Description**: Rewrite the plugin entry point to create context, call module setup functions, and register hooks.
- **Files to create**: `src/plugins/system/web-ui/index.ts`
- **Files to modify**:
  - `src/plugins/system/web-ui/web-ui.ts` → rename and rewrite as `index.ts`
  - `src/plugins/system/web-ui/web-ui.test.ts` → rename to `index.test.ts`
- **Dependencies**: All modules from steps 1-9
- **Estimated complexity**: Medium

The new `registerPlugin` body:

1. `request('rest-serve')` + `request('memory')` as before
2. Create user web interface directory as before
3. Create `WebUiContext` via `createContext()`
4. Call `registerScript` / `registerStylesheet` from `extensions.ts`
5. Call `plugin.offer<'web-ui'>()`
6. Register DB models with memory
7. Set up `AgentSystem.onUpdate` listener (still in index since it's glue code)
8. Set up single consolidated `ToolCallEvents.onToolCallEvent` listener (still in index since it's glue code)
9. Register `onAssistantAcceptsRequests` hook — inside:
   a. `ctx.setOrm(await onDatabaseReady(...))`
   b. `registerWebSocket('/ws')`
   c. `setupBroadcast(ctx)` passing `wss` and `wsConnections`
   d. `createMessageRouter(ctx, wsConnections)` → `wss.on('connection', ...)`
   e. `startHeartbeat(ctx, wsConnections)`
   f. `registerChatRoutes(ctx)`
   g. `addExtensionsRoute(ctx)`
   h. `registerStaticRoutes(ctx, currentDir)`
10. Register `onAssistantWillStopAcceptingRequests` shutdown hook

### Step 11: Consolidate `ToolCallEvents` listeners

- **Description**: Merge the two `onToolCallEvent` registrations (lines 583–606 and 612–656) into a single listener that first broadcasts then buffers.
- **Files to modify**: `src/plugins/system/web-ui/index.ts`
- **Estimated complexity**: Low

Before (two listeners):

```typescript
// Listener 1: broadcast
ToolCallEvents.onToolCallEvent(async event => {
  if (event.sessionId === undefined) return;
  broadcastWs({ type: 'tool_call_event', ... });
});

// Listener 2: buffer for DB
ToolCallEvents.onToolCallEvent(async event => {
  if (event.sessionId === undefined) return;
  if (event.type !== 'tool_call_completed' && event.type !== 'tool_call_error') return;
  // ... buffer logic
});
```

After (one listener):

```typescript
ToolCallEvents.onToolCallEvent(async event => {
  if (event.sessionId === undefined) return;

  // 1. Broadcast to WS clients
  broadcastWs({ type: 'tool_call_event', ... });

  // 2. Buffer completed/error events for DB interleaving
  if (event.type === 'tool_call_completed' || event.type === 'tool_call_error') {
    // ... buffer logic
  }
});
```

This is a behavior-preserving change since both listeners fire on the same event emitter and the ordering (broadcast before buffer) stays the same.

### Step 12: Update tests

- **Description**: The test file needs a companion `context.test.ts` (if context functions are tested) and the main test file needs import paths updated. Since this is a pure extraction, most test logic does not change.
- **Files to modify**: `src/plugins/system/web-ui/web-ui.test.ts` → rename to `index.test.ts`, update imports
- **Files to create** (optional): `src/plugins/system/web-ui/lib/serialization.test.ts`
- **Estimated complexity**: Medium

Key test file changes:

- Change `import webUiPlugin from './web-ui.js'` → `import webUiPlugin from './index.js'`
- Tests for `registerScript`, `registerStylesheet`, chat routes, WS handlers all pass through the same public API — they don't need to change since the plugin interface is unchanged.

### Step 13: Update internal imports in `ws-types.ts` consumers

- **Description**: `useToolCallEvents.ts` imports from `../../ws-types.js`. After refactor, the relative path from `client/hooks/useToolCallEvents.ts` to `ws-types.ts` doesn't change since both stay in the same parent directory.
- **Files to modify**: None needed — `ws-types.ts` stays at `web-ui/ws-types.ts`
- **Estimated complexity**: Low

## File Changes Summary

| File                                               | Action                   | Description                                      |
| -------------------------------------------------- | ------------------------ | ------------------------------------------------ |
| `src/plugins/system/web-ui/context.ts`             | Create                   | Shared context type + factory                    |
| `src/plugins/system/web-ui/lib/serialization.ts`   | Create                   | Pure serialization helpers                       |
| `src/plugins/system/web-ui/lib/db-persistence.ts`  | Create                   | DB persistence operations                        |
| `src/plugins/system/web-ui/lib/session-manager.ts` | Create                   | Session lifecycle + operation queue              |
| `src/plugins/system/web-ui/lib/extensions.ts`      | Create                   | Script/stylesheet registration + /api/extensions |
| `src/plugins/system/web-ui/lib/ws-broadcast.ts`    | Create                   | WS broadcast + heartbeat                         |
| `src/plugins/system/web-ui/lib/ws-handlers.ts`     | Create                   | WS message handlers                              |
| `src/plugins/system/web-ui/routes/http-chat.ts`    | Create                   | Chat HTTP routes                                 |
| `src/plugins/system/web-ui/routes/static.ts`       | Create                   | Static file routes                               |
| `src/plugins/system/web-ui/web-ui.ts`              | Delete                   | Replaced by `index.ts`                           |
| `src/plugins/system/web-ui/index.ts`               | Create                   | Plugin entry point (rewritten)                   |
| `src/plugins/system/web-ui/web-ui.test.ts`         | Rename → `index.test.ts` | Updated imports                                  |

## Testing Strategy

### Unit tests

- `serialization.test.ts`: Test `restoreConversationMessages`, `serializeCompactedContext`, `restoreCompactedContext`, `buildWsSession`, `serializeRound` with various inputs including empty rounds, tool_call rounds, null/undefined values
- Existing `index.test.ts`: All 19 existing tests pass unchanged. The mock setup in `createMockPluginInterface` already exposes the same public API surface.
- New integration tests (optional): Test `session-manager` queue serialization by submitting concurrent requests

### Manual testing

1. Start the server, open web UI — welcome screen appears
2. Click "New Chat" — session created, assistant responds
3. Send messages — streaming works, tool calls appear, read receipts show
4. Delete session — "Archiving..." appears, session removed from sidebar
5. Reload page — sessions list populates from WS
6. Open compacted session — messages restored with compaction state
7. Open two browser tabs — both receive WS broadcasts

## Definition of Done

- [ ] `index.ts` is ≤ 200 lines (glue code only)
- [ ] All 19 existing tests pass without modification (only import path updated)
- [ ] `npm run build:server` succeeds
- [ ] `npm run build:client` succeeds
- [ ] `npm run lint` passes
- [ ] `npm test` passes (all 555+ tests)
- [ ] Manual smoke test: send message, see streaming, see tool calls
- [ ] Single `ToolCallEvents.onToolCallEvent` listener (not two)
- [ ] No file exceeds ~400 lines (largest expected: `lib/ws-handlers.ts` at ~350 lines, `lib/session-manager.ts` at ~300 lines)
- [ ] `plugin.offer<'web-ui'>` capabilities are byte-for-byte identical (same methods, same signatures)

## Risks & Mitigations

| Risk                                                                          | Impact                                                         | Mitigation                                                                                                                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Closures capturing stale `broadcastWs` after extraction                       | WS messages silently dropped                                   | `broadcastWs` is late-bound via `ctx.setBroadcastWs()` — it's assigned in `onAssistantAcceptsRequests` before any WS handler can fire. Test verifies WS broadcasts. |
| `runSessionOperation` queue behavior changes                                  | Concurrent sessions get deadlocked                             | Queue logic unchanged. The queue is a Map keyed by sessionId — each session has its own queue. Extraction doesn't change this.                                      |
| `AgentSystem.onUpdate` / `ToolCallEvents.onToolCallEvent` registration timing | Events fire before `broadcastWs` is assigned                   | `broadcastWs` defaults to no-op. These events only matter once the server is accepting requests, at which point `broadcastWs` is already assigned.                  |
| Test mock plumbing breaks                                                     | Test file needs substantial rewrite                            | The test file tests through the public `registerPlugin` interface. The mock system creates a complete `pluginInterface` — module boundaries are invisible to tests. |
| Import resolution errors from renamed files                                   | Build fails                                                    | All imports use `.js` extensions and follow NodeNext resolution. The rename from `web-ui.ts` to `index.ts` only affects the default export import in the test file. |
| TypeScript strict mode violations in new files                                | `@typescript-eslint/no-explicit-any` or `noImplicitAny` errors | All extracted functions preserve their original type signatures. The only `any` usage is in tests (allowed per project conventions).                                |

## Timeline Estimate

- ~2 hours for extraction (steps 1-10)
- ~30 min for listener consolidation (step 11)
- ~30 min for test updates (step 12)
- ~30 min for verification (lint, build, test suite)

**Total: ~3.5 hours** assuming no behavioral surprises. The extraction is mechanical — move functions, thread context parameters, update imports. Most time is verifying nothing broke.
