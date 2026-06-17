# Implementation Plan: `mcp-client` Web UI

## Overview

Add a browser-side UI surface to the `mcp-client` community plugin delivered by `./plans/mcp-client-plugin-implementation-plan.md`. The UI lives in the collapsible right-hand settings panel (below the pages menu) and on a dedicated `/mcp-servers` route, and provides three capabilities:

1. **Read-only status table** of all configured MCP servers (id, transport, connection status, restart attempts, tool count).
2. **Per-server reconnect button** to force a restart attempt without an assistant restart.
3. **Per-server expanded tool list** with active vs previously-seen sections, and per-server / per-tool taint override editing. Taint overrides are the key feature: they let the user promote a trusted local MCP server's tools from the default `tainted` to `clean` (usable from voice / secure contexts) or demote a tool to `secure` (locked out of tainted conversations).

This is the third plan in the "great MCP client project" sequence and depends on the second plan landing first:

```
DTNs (plan 1)  →  mcp-client plugin (plan 2)  →  mcp-client web UI (this plan)
```

### Key architectural decisions (decided per Q&A)

1. **Two separate storage layers for two separate concerns.**
   - **Seen-tool records → SQLite** (via the `memory` plugin). Auto-expiring cache of "what tools has this server offered, and when did we last see them." Rebuilt from scratch if wiped. Lives in a new `McpClientSeenTool` entity.
   - **Taint overrides → `overrides.json`** at `~/.alice-assistant/plugin-settings/mcp-client/overrides.json`. Persistent. Never auto-expires. The user's intent, decoupled from the server's behavior.

2. **Taint precedence chain (highest wins):**
   1. Per-tool override from `overrides.json`
   2. Per-server override from `overrides.json` (set via UI)
   3. Per-server `taintOverride` from `mcp.json` (the seed value, set at config time)
   4. Default `tainted`

   This makes `mcp.json`'s `taintOverride` a _fallback/seed_: it applies if the user hasn't overridden it via the UI. The UI's value wins. Clearing a UI override falls back to `mcp.json`. No "two sources of truth" problem — there's always exactly one winner at each level.

3. **Per-tool overrides persist forever** (in `overrides.json`), with explicit "forget override" buttons in the UI. Auto-expiration of seen-tool rows never expires the override. Predictable over tidy.

4. **Seen-tool retention default: 30 days**, configurable via `seenToolRetentionDays` in `mcp-client.json`.

5. **Expiration cleanup runs per-server on every `syncTools` call** + a full sweep on shutdown. No new timer infrastructure.

6. **Taint changes take effect immediately** via `ServerManager.reSyncTaint(entryId)` which unregisters-and-re-registers the server's tools through the DTN with recomputed taint. Effective on the next LLM request.

7. **UI shows two sections per server: active tools (currently offered) and previously seen tools (within retention, not currently offered).** Clearer than a merged list with status dots.

8. **Per-tool override UI offers three taint buttons + an explicit "inherit from server" / "clear override" button.** Explicit over clever — the user can always tell what's set vs inherited.

9. **5-second polling with `visibilitychange` gating** for live status updates, matching the mood widget pattern.

10. **New core web-ui region `settings-panel-below-nav`** so the MCP status widget can sit below the pages menu in the right-hand settings panel as the user requested. (Today's `settings-panel` region sits _above_ the pages nav in `SettingsPanel.tsx`, which is the wrong place.)

### Non-goals (deferred)

- **Full `mcp.json` editor.** Server connection params (`command`, `args`, `url`, `enabled`) remain read-only in the UI; the user edits `mcp.json` directly and restarts. The UI surfaces a "needs restart" notice. (Q1 decision.)
- **OAuth-authenticated MCP server flows.** The mcp-client plan already punted these to a fast-follow; this plan doesn't touch auth.
- **Hot-reload of `mcp.json` or `overrides.json`.** `overrides.json` is hot-reloaded in memory (the plugin re-reads it on every taint override write), but `mcp.json` still requires a restart, matching the mcp-client plan and project convention.
- **A sidebar-bottom widget.** The Q5 conversation refined the placement to "below the pages menu in the right-hand settings panel," not the left sidebar.
- **MCP prompts UI.** The mcp-client plan didn't surface prompts; this plan doesn't either.
- **Non-text tool results UI.** Same as the mcp-client plan.

## Requirements Summary

| #   | Requirement                                                                                                                                                                                                                   | Type           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| R1  | The plugin registers a browser bundle (`mcp-client-web-ui.js`) and stylesheet (`mcp-client-web-ui.css`) via `webUi.registerScript` / `webUi.registerStylesheet` during `onAssistantAcceptsRequests`                           | Functional     |
| R2  | A new `settings-panel-below-nav` UI region is added to the core web-ui client (`SettingsPanel.tsx`), placed below the pages nav, and exported from the `UIRegion` type                                                        | Functional     |
| R3  | The plugin registers a `McpStatusSummary` component into `settings-panel-below-nav` showing aggregate status (N connected, M dead, K total) with a link to open `/mcp-servers`                                                | Functional     |
| R4  | The plugin registers a `McpServersPage` component as a dedicated route at `/mcp-servers` (via `PluginClientExport.routes`), listed in the pages nav with title "MCP Servers"                                                  | Functional     |
| R5  | `GET /api/mcp-client/statuses` returns `ServerStatusSnapshot[]` with each server's id, canonicalServerId, transport, status, restartAttempts, and active tools (canonicalName, mcpName, description, effectiveTaint)          | Functional     |
| R6  | `GET /api/mcp-client/seen-tools/:serverId` returns `SeenToolRecord[]` including inactive tools within the retention window, each with mcpName, canonicalName, lastSeenAt, and effectiveTaint                                  | Functional     |
| R7  | `POST /api/mcp-client/servers/:serverId/reconnect` forces a restart attempt via `ServerManager.startServer(entry)` and returns the new status                                                                                 | Functional     |
| R8  | `POST /api/mcp-client/overrides/servers/:serverId` with body `{ taintOverride: 'clean'\|'secure'\|'tainted'\|null }` sets or clears (null) the per-server override in `overrides.json`, then triggers `reSyncTaint(serverId)` | Functional     |
| R9  | `DELETE /api/mcp-client/overrides/servers/:serverId` clears the per-server override (equivalent to `taintOverride: null`) and triggers `reSyncTaint`                                                                          | Functional     |
| R10 | `POST /api/mcp-client/overrides/servers/:serverId/tools/:toolName` with body `{ taintOverride: 'clean'\|'secure'\|'tainted'\|null }` sets or clears the per-tool override, then triggers `reSyncTaint`                        | Functional     |
| R11 | `DELETE /api/mcp-client/overrides/servers/:serverId/tools/:toolName` clears the per-tool override and triggers `reSyncTaint`                                                                                                  | Functional     |
| R12 | The precedence chain (per-tool > per-server-UI > per-server-mcp.json > default `tainted`) is computed at tool-registration time and stamped on every DTN-registered tool's `taintStatus`                                      | Functional     |
| R13 | All taint override writes persist to `overrides.json` at `~/.alice-assistant/plugin-settings/mcp-client/overrides.json` (created on first write; missing file = no overrides)                                                 | Functional     |
| R14 | `overrides.json` schema: `{ servers: { <serverId>: { taintOverride?: 'clean'\|'secure'\|'tainted', tools: { <toolName>: { taintOverride: 'clean'\|'secure'\|'tainted' } } } } }`                                              | Functional     |
| R15 | `overrides.json` is re-read from disk on every REST write (no in-memory cache that can drift), validating against the schema before persisting                                                                                | Functional     |
| R16 | When a tool registers via the DTN, its `taintStatus` is computed as: per-tool override (if set) → per-server UI override (if set) → `mcp.json` `taintOverride` (if set) → `tainted`                                           | Functional     |
| R17 | A new `McpClientSeenTool` SQLite entity is registered with the `memory` plugin, with fields: id, serverId, mcpToolName, canonicalToolName, description, firstSeenAt (datetime), lastSeenAt (datetime)                         | Functional     |
| R18 | Every `syncTools` call upserts a `McpClientSeenTool` row per active tool (updating `lastSeenAt` and `description`), then sweeps expired rows for that server (where `lastSeenAt < now - retentionDays`)                       | Functional     |
| R19 | On `onAssistantWillStopAcceptingRequests`, a full sweep of expired `McpClientSeenTool` rows runs across all servers                                                                                                           | Functional     |
| R20 | `seenToolRetentionDays` is configurable in `mcp-client.json` (default 30, minimum 1)                                                                                                                                          | Functional     |
| R21 | The UI polls `GET /api/mcp-client/statuses` every 5 seconds while the page is visible, stopping on `visibilitychange` to hidden (matching the mood widget pattern)                                                            | Functional     |
| R22 | The `McpServersPage` renders a row per server with: id, transport badge, status badge (color-coded), restart attempts, and a "Reconnect" button (disabled unless status is `failed` or `dead`)                                | Functional     |
| R23 | Each server row is expandable. Expanded view shows two sections: "Active tools (N)" with currently-registered tools and "Previously seen (M)" with inactive-but-within-retention tools                                        | Functional     |
| R24 | Each active tool row shows: canonical name, MCP name, description, effective taint badge, and four buttons: `tainted` / `clean` / `secure` / `inherit` (the last clears the per-tool override)                                | Functional     |
| R25 | Each previously-seen tool row shows the same fields but greyed out, with taint buttons still functional (override persists even when the tool isn't currently offered)                                                        | Functional     |
| R26 | Each server row has a server-level taint control with the same four-button pattern (`tainted` / `clean` / `secure` / `inherit`), affecting all tools on that server that don't have a per-tool override                       | Functional     |
| R27 | The `McpStatusSummary` widget in `settings-panel-below-nav` shows "MCP: N/M servers connected (K dead)" with color coding, and clicking it navigates to `/mcp-servers`                                                        | Functional     |
| R28 | All REST endpoints return JSON errors with `{ error: string }` shape and name the offending server id where applicable                                                                                                        | Non-functional |
| R29 | The browser bundle uses `globalThis.React` (not direct imports), `PluginClientExport` default export shape, and is built with esbuild into `dist/plugins/community/mcp-client/mcp-client-web-ui.js`                           | Non-functional |
| R30 | A new `build:mcp-client-ui` npm script is added and chained into the top-level `build` script                                                                                                                                 | Non-functional |
| R31 | All new code is co-located with tests (`*.test.ts`), uses ESM `.js` imports, follows Prettier config, and avoids `any` in non-test code                                                                                       | Non-functional |
| R32 | The plugin continues to load and bridge tools even if `web-ui` is disabled — the UI registration is wrapped in `if (webUi)` guards (matches the mcp-client plan's R24 precedent for `rest-serve`)                             | Non-functional |

### Out of Scope

- Editing `mcp.json` from the UI (Q1: read-only)
- OAuth flows (deferred to a later plan)
- Hot-reload of `mcp.json` (deferred to a later plan)
- Sidebar-bottom widget (Q5 refined placement to right-hand panel)
- MCP prompts (mcp-client plan didn't surface them)
- Non-text tool result rendering (mcp-client plan deferred)

## Architecture & Design

### High-level flow

```
mcp-client plugin (delivered by plan 2)
  │
  ├── registerPlugin (unchanged from plan 2, plus):
  │     ├── memory.registerDatabaseModels([McpClientSeenTool])  ◀── NEW entity
  │     ├── memory.onDatabaseReady(async orm => { cache orm in manager })
  │     └── plugin.offer<'mcp-client'>({ getServerStatuses, reSyncTaint, reconnectServer, ... })
  │
  ├── onAssistantWillAcceptRequests (unchanged from plan 2)
  │     └── manager.startAll()
  │
  ├── onAssistantAcceptsRequests  ◀── NEW hook added by this plan
  │     ├── const webUi = plugin.request('web-ui')
  │     ├── if (webUi) {
  │     │     webUi.registerScript(path.join(currentDir, 'mcp-client-web-ui.js'))
  │     │     webUi.registerStylesheet(path.join(currentDir, 'mcp-client-web-ui.css'))
  │     │   }
  │     └── register REST routes on rest-serve.express:
  │           GET    /api/mcp-client/statuses
  │           GET    /api/mcp-client/seen-tools/:serverId
  │           POST   /api/mcp-client/servers/:serverId/reconnect
  │           POST   /api/mcp-client/overrides/servers/:serverId
  │           DELETE /api/mcp-client/overrides/servers/:serverId
  │           POST   /api/mcp-client/overrides/servers/:serverId/tools/:toolName
  │           DELETE /api/mcp-client/overrides/servers/:serverId/tools/:toolName
  │
  └── onAssistantWillStopAcceptingRequests (extended from plan 2)
        ├── manager.stopAll()  (unchanged)
        └── await SeenToolStore.sweepAllExpired(orm, retentionDays)  ◀── NEW

Browser bundle (mcp-client-web-ui.tsx, built by esbuild)
  │
  ├── default export: PluginClientExport {
  │     routes: [{ path: '/mcp-servers', title: 'MCP Servers', component: McpServersPage }],
  │     onAliceUIReady(api) { api.registerComponent('settings-panel-below-nav', McpStatusSummary) }
  │   }
  │
  ├── McpStatusSummary: aggregate status, polls /api/mcp-client/statuses every 5s,
  │     click → navigate to /mcp-servers
  │
  └── McpServersPage: full status table, expandable rows, taint editing, reconnect buttons
```

### Component breakdown

| Component                            | File                                                                     | Responsibility                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Server-side: SeenToolStore           | `src/plugins/community/mcp-client/seen-tool-store.ts` (new)              | SQLite CRUD for `McpClientSeenTool`: upsert, sweepExpired, listByServer                                     |
| Server-side: OverridesStore          | `src/plugins/community/mcp-client/overrides-store.ts` (new)              | Read/write `overrides.json` with schema validation; precedence resolution                                   |
| Server-side: REST routes             | `src/plugins/community/mcp-client/routes.ts` (new)                       | All 7 REST endpoints, express handlers                                                                      |
| Server-side: ServerManager extension | `src/plugins/community/mcp-client/server-manager.ts` (modify)            | Add `reSyncTaint(entryId)`, hook `syncTools` to upsert seen-tool rows + sweep, expose `reconnectServer(id)` |
| Server-side: DB entity               | `src/plugins/community/mcp-client/db-schemas/McpClientSeenTool.ts` (new) | MikroORM entity definition                                                                                  |
| Server-side: Plugin entry            | `src/plugins/community/mcp-client/mcp-client.ts` (modify)                | Wire memory entity registration, ORM caching, REST routes, web-ui registration                              |
| Server-side: Config extension        | `src/plugins/community/mcp-client/config.ts` (modify)                    | Add `seenToolRetentionDays` to `mcp-client.json` schema                                                     |
| Server-side: Types                   | `src/plugins/community/mcp-client/types.ts` (modify)                     | Add `SeenToolRecord`, `EffectiveTaint`, `ServerStatusSnapshot` (extended from plan 2)                       |
| Browser: Bundle entry                | `src/plugins/community/mcp-client/mcp-client-web-ui.tsx` (new)           | PluginClientExport, McpStatusSummary, McpServersPage, all sub-components                                    |
| Browser: Stylesheet                  | `src/plugins/community/mcp-client/mcp-client-web-ui.css` (new)           | Status badges, table layout, taint button states                                                            |
| Core web-ui: New region              | `src/plugins/system/web-ui/client/components/SettingsPanel.tsx` (modify) | Add `<RegionSlot region="settings-panel-below-nav" />` below the pages nav                                  |
| Core web-ui: Type                    | `src/plugins/system/web-ui/client/types/index.ts` (modify)               | Add `'settings-panel-below-nav'` to `UIRegion` union                                                        |
| Build: package.json                  | `package.json` (modify)                                                  | Add `build:mcp-client-ui` script and chain into `build`                                                     |

### Data models

**`McpClientSeenTool` SQLite entity (new):**

```typescript
import { defineEntity, p } from '@mikro-orm/sqlite';

const McpClientSeenToolSchema = defineEntity({
  name: 'McpClientSeenTool',
  properties: {
    id: p.integer().primary(),
    serverId: p.string(), // the user-supplied id from mcp.json (not sanitized)
    mcpToolName: p.string(), // original MCP tool name
    canonicalToolName: p.string(), // full mcp_client.<server>__<tool> name
    description: p.text().nullable(),
    firstSeenAt: p.datetime(),
    lastSeenAt: p.datetime(),
  },
});

export class McpClientSeenTool extends McpClientSeenToolSchema.class {}
McpClientSeenToolSchema.setClass(McpClientSeenTool);
```

The `(serverId, mcpToolName)` pair is unique — upserts on `syncTools` use it as the lookup key. (A unique index on this pair is added at registration time via the `@mikro-orm` decorator support or a schema migration. If the project's MikroORM setup doesn't easily support composite unique constraints, the store falls back to find-then-update which is fine at the volumes involved — a server typically offers tens of tools, not thousands.)

**`overrides.json` (new file, `~/.alice-assistant/plugin-settings/mcp-client/overrides.json`):**

```typescript
const OverridesSchema = Type.Object({
  servers: Type.Record(
    Type.String(), // serverId
    Type.Object({
      taintOverride: Type.Optional(
        Type.Union([
          Type.Literal('clean'),
          Type.Literal('secure'),
          Type.Literal('tainted'),
        ])
      ),
      tools: Type.Record(
        Type.String(), // mcpToolName (original, not sanitized)
        Type.Object({
          taintOverride: Type.Union([
            Type.Literal('clean'),
            Type.Literal('secure'),
            Type.Literal('tainted'),
          ]),
        })
      ),
    })
  ),
});
```

Key choice: `overrides.json` is keyed by `serverId` (the user-supplied id from `mcp.json`) and `mcpToolName` (the original MCP tool name, not the sanitized Alice canonical name). This means overrides survive sanitization-rule changes in the plugin and stay human-readable. The plugin resolves from server id → canonical server id → tool name at registration time.

**`ServerStatusSnapshot` (extended from plan 2):**

```typescript
type ServerStatusSnapshot = {
  id: string;
  canonicalServerId: string;
  transport: 'stdio' | 'streamable-http';
  status: 'pending' | 'connected' | 'failed' | 'dead' | 'stopped';
  restartAttempts: number;
  activeTools: Array<{
    canonicalName: string;
    mcpName: string;
    description: string;
    effectiveTaint: 'tainted' | 'clean' | 'secure';
    overrideSource: 'tool' | 'server-ui' | 'server-config' | 'default';
  }>;
};
```

The `overrideSource` field tells the UI _why_ a tool has the taint it does, so the "inherit" button can render correctly (it should be highlighted when the tool has no per-tool override and is inheriting from the server level).

**`SeenToolRecord` (for the `GET /seen-tools/:serverId` endpoint):**

```typescript
type SeenToolRecord = {
  mcpToolName: string;
  canonicalToolName: string;
  description: string | null;
  lastSeenAt: string; // ISO
  isActive: boolean;
  effectiveTaint: 'tainted' | 'clean' | 'secure';
  overrideSource: 'tool' | 'server-ui' | 'server-config' | 'default';
};
```

### API contracts

**Plugin capability extension (offered via `plugin.offer<'mcp-client'>`):**

Plan 2's `getServerStatuses()` is extended to return the rich `ServerStatusSnapshot[]` shown above (with per-tool `effectiveTaint` and `overrideSource`). New methods:

```typescript
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'mcp-client': {
      getServerStatuses: () => ServerStatusSnapshot[];
      reconnectServer: (
        serverId: string
      ) => Promise<ServerStatusSnapshot | null>;
      reSyncTaint: (serverId: string) => Promise<void>;
      getSeenTools: (serverId: string) => Promise<SeenToolRecord[]>;
      // Override manipulation (also called from REST handlers):
      setServerTaintOverride: (
        serverId: string,
        taint: TaintLevel | null
      ) => Promise<void>;
      setToolTaintOverride: (
        serverId: string,
        mcpToolName: string,
        taint: TaintLevel | null
      ) => Promise<void>;
    };
  }
}

type TaintLevel = 'tainted' | 'clean' | 'secure';
```

The REST handlers are thin wrappers around these capability methods. They live in `routes.ts` and do parameter validation + error formatting only; the actual logic is in the `ServerManager` and `OverridesStore`.

### Interaction with existing systems

**memory plugin:** New entity `McpClientSeenTool` registered via `memory.registerDatabaseModels([McpClientSeenTool])` during `registerPlugin`, before any `onDatabaseReady` callback fires. The ORM is cached via `memory.onDatabaseReady(async orm => orm)` and threaded into the `ServerManager` and `SeenToolStore`. Matches the pattern in `src/plugins/system/voice/voice.ts` (lines 53–61) and `src/plugins/community/teach/teach.ts` (lines 570–582).

**web-ui plugin:** `plugin.request('web-ui')` returns the existing API surface (`registerScript`, `registerStylesheet`). This plan adds a new region (`settings-panel-below-nav`) to the _core_ web-ui client, not to the mcp-client plugin — that's a small change to `SettingsPanel.tsx` and the `UIRegion` type. Once added, the mcp-client browser bundle registers its `McpStatusSummary` component into that region via `api.registerComponent('settings-panel-below-nav', ...)` in `onAliceUIReady`.

**rest-serve plugin:** All 7 REST endpoints are registered on `restServe.express` inside the `onAssistantAcceptsRequests` hook (matching the credential-store, google-apis, and voice patterns). The plugin already declares a `rest-serve` dependency in plan 2; no new dependency.

**DTN machinery (plan 1):** `reSyncTaint(serverId)` uses the same `dtn.registerTool`/`dtn.unregisterTool` calls as `syncTools` — just in a tighter loop that unregisters-and-re-registers every active tool for the server with recomputed taint. No new DTN API surface needed; the DTN plan already delivers everything this plan consumes.

**Taint system:** `buildLlmToolDefinitions` and `tool-executor.ts` operate on the `taintStatus` field of `Tool` objects in `tools[]`. This plan changes _which_ `taintStatus` value gets stamped on each DTN-registered tool (via the precedence chain), but doesn't change how the downstream machinery uses it. The `reSyncTaint` flow is what makes a UI taint change visible to the next LLM request: unregister the old `Tool` object, register a new one with the new `taintStatus`, and `buildLlmToolDefinitions` picks it up on the next call.

## New Package Dependencies

None. The browser bundle uses `globalThis.React` (provided by the host web-ui bundle), and the server-side code uses existing dependencies (`express`, `typebox`, `@mikro-orm/sqlite` already in the project). The mcp-client plan already added `@modelcontextprotocol/sdk`, `zod`, and `@cfworker/json-schema`; this plan adds nothing new on top of that.

## Project Structure

The browser bundle follows the credential-store / google-apis / mood precedent: a single `.tsx` file built by a dedicated esbuild script into `dist/plugins/community/mcp-client/mcp-client-web-ui.js`, registered server-side via `webUi.registerScript`. The new `settings-panel-below-nav` region is a small core change to the web-ui client (two files: `SettingsPanel.tsx` and `types/index.ts`).

### Files

| File                                                               | Action | Description                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/plugins/community/mcp-client/mcp-client.ts`                   | Modify | Wire memory entity registration, ORM caching, REST route registration in `onAssistantAcceptsRequests`, web-ui script/stylesheet registration, extended capability offer                                                                                 |
| `src/plugins/community/mcp-client/server-manager.ts`               | Modify | Add `reSyncTaint`, `reconnectServer`, hook `syncTools` to upsert seen-tool rows + sweep expired, accept ORM + retention config in constructor, compute effective taint per tool via `OverridesStore` at registration time                               |
| `src/plugins/community/mcp-client/config.ts`                       | Modify | Add `seenToolRetentionDays` (default 30, min 1) to `McpClientPluginConfigSchema`                                                                                                                                                                        |
| `src/plugins/community/mcp-client/types.ts`                        | Modify | Add `TaintLevel`, `SeenToolRecord`, extend `ServerStatusSnapshot` with `activeTools[]` and `overrideSource`                                                                                                                                             |
| `src/plugins/community/mcp-client/seen-tool-store.ts`              | Create | `SeenToolStore` class: `upsert(serverId, mcpToolName, canonicalName, description)`, `sweepExpired(serverId, retentionDays)`, `sweepAllExpired(retentionDays)`, `listByServer(serverId)`                                                                 |
| `src/plugins/community/mcp-client/overrides-store.ts`              | Create | `OverridesStore` class: `load()`, `save()`, `setServerOverride(serverId, taint\|null)`, `setToolOverride(serverId, mcpToolName, taint\|null)`, `resolveEffectiveTaint(serverId, mcpToolName, mcpJsonServerOverride?)` implementing the precedence chain |
| `src/plugins/community/mcp-client/routes.ts`                       | Create | Express route handlers for all 7 endpoints; thin wrappers around capability methods                                                                                                                                                                     |
| `src/plugins/community/mcp-client/db-schemas/McpClientSeenTool.ts` | Create | MikroORM entity definition                                                                                                                                                                                                                              |
| `src/plugins/community/mcp-client/mcp-client-web-ui.tsx`           | Create | Browser bundle: `PluginClientExport`, `McpStatusSummary` widget, `McpServersPage`, all sub-components                                                                                                                                                   |
| `src/plugins/community/mcp-client/mcp-client-web-ui.css`           | Create | Styles for status badges, table, taint buttons                                                                                                                                                                                                          |
| `src/plugins/community/mcp-client/seen-tool-store.test.ts`         | Create | Unit tests for upsert/sweep/list                                                                                                                                                                                                                        |
| `src/plugins/community/mcp-client/overrides-store.test.ts`         | Create | Unit tests for precedence chain, persistence, schema validation                                                                                                                                                                                         |
| `src/plugins/community/mcp-client/routes.test.ts`                  | Create | Unit tests for REST handlers with mocked capability methods                                                                                                                                                                                             |
| `src/plugins/community/mcp-client/mcp-client-web-ui.test.ts`       | Create | Unit tests for browser components (render-less, mock fetch)                                                                                                                                                                                             |
| `src/plugins/system/web-ui/client/components/SettingsPanel.tsx`    | Modify | Add `<RegionSlot region="settings-panel-below-nav" />` below the pages nav                                                                                                                                                                              |
| `src/plugins/system/web-ui/client/types/index.ts`                  | Modify | Add `'settings-panel-below-nav'` to `UIRegion` union                                                                                                                                                                                                    |
| `package.json`                                                     | Modify | Add `build:mcp-client-ui` script, chain into `build`                                                                                                                                                                                                    |

## Implementation Steps

### Step 1: Add the `settings-panel-below-nav` region to core web-ui

**Files:** `src/plugins/system/web-ui/client/types/index.ts`, `src/plugins/system/web-ui/client/components/SettingsPanel.tsx`
**Complexity:** Low
**Dependencies:** None

In `types/index.ts`, extend the `UIRegion` union (line 64–71):

```typescript
export type UIRegion =
  | 'sidebar-top'
  | 'sidebar-bottom'
  | 'chat-header'
  | 'message-prefix'
  | 'message-suffix'
  | 'input-prefix'
  | 'settings-panel'
  | 'settings-panel-below-nav';
```

In `SettingsPanel.tsx`, add the new `RegionSlot` _after_ the plugin-nav block (currently lines 35–55), inside the `settings-panel__body` div:

```tsx
<div className="settings-panel__body">
  <RegionSlot region="settings-panel" />
  {routes.length > 0 ? (
    <nav className="settings-panel__nav plugin-nav" aria-label="Plugin pages">
      {routes.map(route => (
        <NavLink ...>{pluginRouteLabel(route)}</NavLink>
      ))}
    </nav>
  ) : null}
  <RegionSlot region="settings-panel-below-nav" />  {/* NEW */}
  <p className="settings-panel__placeholder">...</p>
</div>
```

The new slot sits below the pages nav, so the MCP status widget appears there. Existing `settings-panel` region content stays where it was (above the nav); no behavior change for existing plugins that register into it.

### Step 2: Write the `McpClientSeenTool` entity

**File:** `src/plugins/community/mcp-client/db-schemas/McpClientSeenTool.ts`
**Complexity:** Low
**Dependencies:** None

```typescript
import { defineEntity, p } from '@mikro-orm/sqlite';

const McpClientSeenToolSchema = defineEntity({
  name: 'McpClientSeenTool',
  properties: {
    id: p.integer().primary(),
    serverId: p.string(),
    mcpToolName: p.string(),
    canonicalToolName: p.string(),
    description: p.text().nullable(),
    firstSeenAt: p.datetime(),
    lastSeenAt: p.datetime(),
  },
});

export class McpClientSeenTool extends McpClientSeenToolSchema.class {}
McpClientSeenToolSchema.setClass(McpClientSeenTool);
```

### Step 3: Write the `SeenToolStore`

**File:** `src/plugins/community/mcp-client/seen-tool-store.ts`
**Complexity:** Medium
**Dependencies:** Step 2

```typescript
import type { MikroORM } from '@mikro-orm/sqlite';
import { McpClientSeenTool } from './db-schemas/McpClientSeenTool.js';

export class SeenToolStore {
  constructor(private orm: MikroORM) {}

  async upsert(
    serverId: string,
    mcpToolName: string,
    canonicalToolName: string,
    description: string | null
  ): Promise<void> {
    const em = this.orm.em.fork();
    const repo = em.getRepository(McpClientSeenTool);
    const existing = await repo.findOne({ serverId, mcpToolName });
    const now = new Date();
    if (existing) {
      existing.canonicalToolName = canonicalToolName;
      existing.description = description;
      existing.lastSeenAt = now;
    } else {
      repo.create({
        serverId,
        mcpToolName,
        canonicalToolName,
        description,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
    await em.flush();
  }

  async sweepExpired(serverId: string, retentionDays: number): Promise<number> {
    const em = this.orm.em.fork();
    const repo = em.getRepository(McpClientSeenTool);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const expired = await repo.find({ serverId, lastSeenAt: { $lt: cutoff } });
    await repo.remove(expired);
    await em.flush();
    return expired.length;
  }

  async sweepAllExpired(retentionDays: number): Promise<number> {
    const em = this.orm.em.fork();
    const repo = em.getRepository(McpClientSeenTool);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const expired = await repo.find({ lastSeenAt: { $lt: cutoff } });
    await repo.remove(expired);
    await em.flush();
    return expired.length;
  }

  async listByServer(serverId: string): Promise<McpClientSeenTool[]> {
    const em = this.orm.em.fork();
    return em.getRepository(McpClientSeenTool).find({ serverId });
  }
}
```

Write `seen-tool-store.test.ts` with the ORM mocked (use the pattern from `reminders-broker.test.ts` lines 74–77). Cover: upsert creates new row, upsert updates existing row's `lastSeenAt`, sweepExpired removes only rows older than cutoff for that server, sweepAllExpired removes across all servers, listByServer returns rows in any order.

### Step 4: Write the `OverridesStore`

**File:** `src/plugins/community/mcp-client/overrides-store.ts`
**Complexity:** Medium
**Dependencies:** None (uses Typebox, Node fs)

```typescript
import { Type, Static } from 'typebox';
import Schema from 'typebox/schema';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const OverridesSchema = Type.Object({
  servers: Type.Record(
    Type.String(),
    Type.Object({
      taintOverride: Type.Optional(
        Type.Union([
          Type.Literal('clean'),
          Type.Literal('secure'),
          Type.Literal('tainted'),
        ])
      ),
      tools: Type.Record(
        Type.String(),
        Type.Object({
          taintOverride: Type.Union([
            Type.Literal('clean'),
            Type.Literal('secure'),
            Type.Literal('tainted'),
          ]),
        })
      ),
    })
  ),
});

type OverridesFile = Static<typeof OverridesSchema>;
type TaintLevel = 'tainted' | 'clean' | 'secure';

export class OverridesStore {
  private filePath: string;

  constructor(private configDir: string) {
    this.filePath = path.join(
      configDir,
      'plugin-settings',
      'mcp-client',
      'overrides.json'
    );
  }

  async load(): Promise<OverridesFile> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (!Schema.Check(OverridesSchema, parsed)) {
        throw new Error(
          `overrides.json at ${this.filePath} failed schema validation`
        );
      }
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { servers: {} };
      }
      throw err;
    }
  }

  async save(data: OverridesFile): Promise<void> {
    if (!Schema.Check(OverridesSchema, data)) {
      throw new Error(
        'Cannot save overrides.json: data fails schema validation'
      );
    }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async setServerOverride(
    serverId: string,
    taint: TaintLevel | null
  ): Promise<void> {
    const data = await this.load();
    if (taint === null) {
      if (data.servers[serverId]) {
        delete data.servers[serverId].taintOverride;
        // If the server entry is now empty (no tools, no override), prune it.
        if (
          !data.servers[serverId].taintOverride &&
          Object.keys(data.servers[serverId].tools).length === 0
        ) {
          delete data.servers[serverId];
        }
      }
    } else {
      data.servers[serverId] ??= { tools: {} };
      data.servers[serverId].taintOverride = taint;
    }
    await this.save(data);
  }

  async setToolOverride(
    serverId: string,
    mcpToolName: string,
    taint: TaintLevel | null
  ): Promise<void> {
    const data = await this.load();
    data.servers[serverId] ??= { tools: {} };
    if (taint === null) {
      delete data.servers[serverId].tools[mcpToolName];
      // Prune empty server entries.
      if (
        !data.servers[serverId].taintOverride &&
        Object.keys(data.servers[serverId].tools).length === 0
      ) {
        delete data.servers[serverId];
      }
    } else {
      data.servers[serverId].tools[mcpToolName] = { taintOverride: taint };
    }
    await this.save(data);
  }

  /**
   * Resolve the effective taint for a tool, applying the precedence chain:
   *   1. per-tool override
   *   2. per-server UI override (from this file)
   *   3. per-server mcp.json taintOverride (passed in)
   *   4. default 'tainted'
   *
   * Returns the taint level and which source won, for UI display.
   */
  async resolveEffectiveTaint(
    serverId: string,
    mcpToolName: string,
    mcpJsonServerOverride?: TaintLevel
  ): Promise<{
    taint: TaintLevel;
    source: 'tool' | 'server-ui' | 'server-config' | 'default';
  }> {
    const data = await this.load();
    const serverEntry = data.servers[serverId];
    if (serverEntry?.tools[mcpToolName]) {
      return {
        taint: serverEntry.tools[mcpToolName].taintOverride,
        source: 'tool',
      };
    }
    if (serverEntry?.taintOverride) {
      return { taint: serverEntry.taintOverride, source: 'server-ui' };
    }
    if (mcpJsonServerOverride) {
      return { taint: mcpJsonServerOverride, source: 'server-config' };
    }
    return { taint: 'tainted', source: 'default' };
  }
}
```

Write `overrides-store.test.ts` covering: missing file → `load()` returns `{servers:{}}`, schema-invalid file → throws, precedence chain (per-tool wins over per-server-UI wins over mcp.json wins over default), `setServerOverride(null)` prunes empty server entries, `setToolOverride(null)` prunes empty server entries, save+reload roundtrip preserves data.

### Step 5: Extend `types.ts` and `config.ts`

**Files:** `src/plugins/community/mcp-client/types.ts`, `src/plugins/community/mcp-client/config.ts`
**Complexity:** Low
**Dependencies:** Steps 3, 4

Add `TaintLevel`, `SeenToolRecord`, `OverrideSource` types to `types.ts`. Add `seenToolRetentionDays` to the `McpClientPluginConfigSchema` in `config.ts`:

```typescript
seenToolRetentionDays: Type.Integer({
  minimum: 1,
  default: 30,
  description: 'Days to retain seen-tool records after a tool was last observed.',
}),
```

### Step 6: Extend `server-manager.ts`

**File:** `src/plugins/community/mcp-client/server-manager.ts`
**Complexity:** High
**Dependencies:** Steps 3, 4, 5

Constructor accepts `SeenToolStore`, `OverridesStore`, `retentionDays`, and each `ServerEntry` carries its `mcpJsonServerOverride` (from the `mcp.json` `taintOverride` field). Modify `syncTools` to:

1. For each MCP tool, call `overridesStore.resolveEffectiveTaint(entry.id, mcpTool.name, entry.taintOverride)` to get the effective taint.
2. Stamp the result onto `buildToolFromMcpTool`'s output `taintStatus` (this overrides plan 2's simpler `entry.taintOverride ?? 'tainted'` logic).
3. After registering, call `seenToolStore.upsert(entry.id, mcpTool.name, canonicalName, mcpTool.description ?? null)`.
4. After the registration loop, call `seenToolStore.sweepExpired(entry.id, retentionDays)`.

Add new methods:

```typescript
async reSyncTaint(serverId: string): Promise<void> {
  const entry = this.entries.find(e => e.id === serverId);
  if (!entry) {
    throw new Error(`MCP server "${serverId}" not found. Check mcp.json.`);
  }
  // Unregister and re-register every active tool so taintStatus is recomputed.
  const toolsToReRegister: Tool[] = [];
  for (const mcpTool of entry.currentMcpTools) {
    const { taint } = await this.overridesStore.resolveEffectiveTaint(
      entry.id, mcpTool.name, entry.taintOverride
    );
    toolsToReRegister.push({ ...buildToolFromMcpTool(entry, mcpTool), taintStatus: taint });
  }
  // Also re-register read_resource and list_resources with recomputed taint.
  // (These inherit the server-level override, never per-tool since they're synthetic.)
  toolsToReRegister.push({ ...buildReadResourceTool(entry), taintStatus: (await this.overridesStore.resolveEffectiveTaint(entry.id, '__read_resource', entry.taintOverride)).taint });
  toolsToReRegister.push({ ...buildListResourcesTool(entry), taintStatus: (await this.overridesStore.resolveEffectiveTaint(entry.id, '__list_resources', entry.taintOverride)).taint });

  // Unregister all current, then re-register with new taint.
  for (const localName of [...entry.registeredToolNames]) {
    this.dtn.unregisterTool(`mcp_client.${localName}`);
    entry.registeredToolNames.delete(localName);
  }
  for (const tool of toolsToReRegister) {
    this.dtn.registerTool(tool);
    entry.registeredToolNames.add(tool.name);
  }
}

async reconnectServer(serverId: string): Promise<ServerStatusSnapshot | null> {
  const entry = this.entries.find(e => e.id === serverId);
  if (!entry) return null;
  // Force a fresh start: clear restartAttempts so the backoff resets.
  entry.restartAttempts = 0;
  entry.status = 'pending';
  await this.startServer(entry);
  return this.getServerStatuses().find(s => s.id === serverId) ?? null;
}

getServerStatuses(): ServerStatusSnapshot[] {
  // Extended from plan 2: each snapshot now includes activeTools with effectiveTaint + overrideSource.
  // Compute by re-resolving via overridesStore for each tool.
  return this.entries.map(async entry => ({
    id: entry.id,
    canonicalServerId: entry.canonicalServerId,
    transport: entry.transport,
    status: entry.status,
    restartAttempts: entry.restartAttempts,
    activeTools: await Promise.all(
      entry.currentMcpTools.map(async mcpTool => {
        const { taint, source } = await this.overridesStore.resolveEffectiveTaint(
          entry.id, mcpTool.name, entry.taintOverride
        );
        return {
          canonicalName: `mcp_client.${buildLocalToolName(entry.canonicalServerId, mcpTool.name)}`,
          mcpName: mcpTool.name,
          description: mcpTool.description ?? '',
          effectiveTaint: taint,
          overrideSource: source,
        };
      })
    ),
  }));
  // Note: getServerStatuses becomes async. Update the capability type accordingly.
}
```

Note: `getServerStatuses` becomes async in this plan (it was sync in plan 2). The capability type and REST handler are updated to await it.

Write `server-manager.test.ts` extensions covering: `syncTools` upserts seen-tool rows, `syncTools` sweeps expired rows for the server, `reSyncTaint` unregisters-and-re-registers with new taint, `reconnectServer` resets restartAttempts and calls startServer, `getServerStatuses` returns effectiveTaint + overrideSource per tool.

### Step 7: Write the REST routes

**File:** `src/plugins/community/mcp-client/routes.ts`
**Complexity:** Medium
**Dependencies:** Step 6

```typescript
import type { Express } from 'express';
import type { ServerManager } from './server-manager.js';
import type { OverridesStore, TaintLevel } from './overrides-store.js';
import type { SeenToolStore } from './seen-tool-store.js';
import type { PluginLogger } from '../../../lib/plugin-logger.js';

const TAINT_LEVELS: TaintLevel[] = ['tainted', 'clean', 'secure'];

function isTaintLevel(v: unknown): v is TaintLevel {
  return typeof v === 'string' && TAINT_LEVELS.includes(v as TaintLevel);
}

export function registerMcpClientRoutes(
  app: Express,
  manager: ServerManager,
  overridesStore: OverridesStore,
  seenToolStore: SeenToolStore,
  retentionDays: number,
  logger: PluginLogger
): void {
  app.get('/api/mcp-client/statuses', async (_req, res) => {
    try {
      const statuses = await manager.getServerStatuses();
      res.json({ statuses });
    } catch (err) {
      res.status(500).json({
        error: `Failed to fetch statuses: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.get('/api/mcp-client/seen-tools/:serverId', async (req, res) => {
    const serverId = req.params.serverId;
    try {
      const rows = await seenToolStore.listByServer(serverId);
      // Augment each row with effectiveTaint + overrideSource + isActive.
      const records = await Promise.all(
        rows.map(async row => {
          const { taint, source } = await overridesStore.resolveEffectiveTaint(
            row.serverId,
            row.mcpToolName,
            /* mcpJsonServerOverride lookup */ undefined
          );
          return {
            mcpToolName: row.mcpToolName,
            canonicalToolName: row.canonicalToolName,
            description: row.description,
            lastSeenAt: row.lastSeenAt.toISOString(),
            isActive: false, // computed below
            effectiveTaint: taint,
            overrideSource: source,
          };
        })
      );
      // Mark active tools: cross-reference with the server's currentMcpTools via manager.
      const status = (await manager.getServerStatuses()).find(
        s => s.id === serverId
      );
      const activeMcpNames = new Set(
        status?.activeTools.map(t => t.mcpName) ?? []
      );
      records.forEach(r => {
        r.isActive = activeMcpNames.has(r.mcpToolName);
      });
      res.json({ serverId, tools: records });
    } catch (err) {
      res.status(500).json({
        error: `Failed to fetch seen tools for server "${serverId}": ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.post('/api/mcp-client/servers/:serverId/reconnect', async (req, res) => {
    const serverId = req.params.serverId;
    try {
      const status = await manager.reconnectServer(serverId);
      if (!status) {
        res.status(404).json({
          error: `MCP server "${serverId}" not found. Check mcp.json.`,
        });
        return;
      }
      res.json({ status });
    } catch (err) {
      res.status(500).json({
        error: `Reconnect failed for server "${serverId}": ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.post('/api/mcp-client/overrides/servers/:serverId', async (req, res) => {
    const serverId = req.params.serverId;
    const { taintOverride } = req.body as { taintOverride?: unknown };
    if (taintOverride !== null && !isTaintLevel(taintOverride)) {
      res.status(400).json({
        error: `taintOverride must be one of ${TAINT_LEVELS.join(', ')}, or null to clear.`,
      });
      return;
    }
    try {
      await overridesStore.setServerOverride(
        serverId,
        taintOverride as TaintLevel | null
      );
      await manager.reSyncTaint(serverId);
      res.json({
        success: true,
        serverId,
        taintOverride: taintOverride ?? 'cleared',
      });
    } catch (err) {
      res.status(500).json({
        error: `Failed to set server override for "${serverId}": ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.delete(
    '/api/mcp-client/overrides/servers/:serverId',
    async (req, res) => {
      const serverId = req.params.serverId;
      try {
        await overridesStore.setServerOverride(serverId, null);
        await manager.reSyncTaint(serverId);
        res.json({ success: true, serverId, taintOverride: 'cleared' });
      } catch (err) {
        res.status(500).json({
          error: `Failed to clear server override for "${serverId}": ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  );

  app.post(
    '/api/mcp-client/overrides/servers/:serverId/tools/:toolName',
    async (req, res) => {
      const { serverId, toolName } = req.params;
      const { taintOverride } = req.body as { taintOverride?: unknown };
      if (taintOverride !== null && !isTaintLevel(taintOverride)) {
        res.status(400).json({
          error: `taintOverride must be one of ${TAINT_LEVELS.join(', ')}, or null to clear.`,
        });
        return;
      }
      try {
        await overridesStore.setToolOverride(
          serverId,
          toolName,
          taintOverride as TaintLevel | null
        );
        await manager.reSyncTaint(serverId);
        res.json({
          success: true,
          serverId,
          toolName,
          taintOverride: taintOverride ?? 'cleared',
        });
      } catch (err) {
        res.status(500).json({
          error: `Failed to set tool override for "${serverId}/${toolName}": ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  );

  app.delete(
    '/api/mcp-client/overrides/servers/:serverId/tools/:toolName',
    async (req, res) => {
      const { serverId, toolName } = req.params;
      try {
        await overridesStore.setToolOverride(serverId, toolName, null);
        await manager.reSyncTaint(serverId);
        res.json({
          success: true,
          serverId,
          toolName,
          taintOverride: 'cleared',
        });
      } catch (err) {
        res.status(500).json({
          error: `Failed to clear tool override for "${serverId}/${toolName}": ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  );
}
```

Write `routes.test.ts` with the manager, overridesStore, and seenToolStore all mocked via `vi.mock`. Cover: 404 for unknown server on reconnect, 400 for invalid taint level, success paths for each endpoint, error propagation when `reSyncTaint` throws.

### Step 8: Wire it all into `mcp-client.ts`

**File:** `src/plugins/community/mcp-client/mcp-client.ts`
**Complexity:** Medium
**Dependencies:** Steps 1–7

Extend plan 2's plugin entry:

1. In `registerPlugin`: add `memory` to dependencies, request it, `memory.registerDatabaseModels([McpClientSeenTool])`, cache ORM via `memory.onDatabaseReady(async orm => orm)`.
2. Construct `SeenToolStore` and `OverridesStore` once ORM is available.
3. Construct `ServerManager` with the new args (seenToolStore, overridesStore, retentionDays).
4. Extend `plugin.offer<'mcp-client'>` with the new capability methods.
5. Add `onAssistantAcceptsRequests` hook: request `web-ui` and `rest-serve`, register script+stylesheet if web-ui available, register REST routes if rest-serve available.
6. Extend `onAssistantWillStopAcceptingRequests`: after `manager.stopAll()`, run `seenToolStore.sweepAllExpired(retentionDays)`.

Plugin metadata dependencies become:

```typescript
dependencies: [
  { id: 'memory', version: 'LATEST' },
  { id: 'rest-serve', version: 'LATEST' },
  { id: 'web-ui', version: 'LATEST' },
],
```

(The `web-ui` dependency is new; plan 2 only declared `rest-serve`. `web-ui` depends on `rest-serve` so both are present when the UI is enabled, but `rest-serve` is `required: true` so it's always there anyway.)

### Step 9: Write the browser bundle

**File:** `src/plugins/community/mcp-client/mcp-client-web-ui.tsx`
**Complexity:** High (largest single file in the plan)
**Dependencies:** Steps 1–8

Follow the credential-store + mood + agents patterns. Single default export of type `PluginClientExport`. Uses `globalThis.React`. Key components:

- **`McpStatusSummary`**: registered into `settings-panel-below-nav`. Polls `/api/mcp-client/statuses` every 5s with visibilitychange gating. Renders "MCP: N/M connected (K dead)" with color coding. Click → `useNavigate()('/mcp-servers')`.
- **`McpServersPage`**: the dedicated route. Renders the server table. Each row has: id, transport badge, status badge, restart attempts, reconnect button, expand toggle.
- **`ServerRow`**: expandable. Expanded shows `<ToolList serverId={...} />`.
- **`ToolList`**: fetches `/api/mcp-client/seen-tools/:serverId` on expand. Renders "Active tools (N)" and "Previously seen (M)" sections.
- **`ToolRow`**: shows canonical name, MCP name, description, effective taint badge, four taint buttons (`tainted` / `clean` / `secure` / `inherit`). The "inherit" button is highlighted when `overrideSource === 'default' || 'server-ui' || 'server-config'` (i.e., no per-tool override is set). Calls the appropriate POST/DELETE endpoint and triggers a re-fetch of both `/statuses` and `/seen-tools/:serverId`.
- **`ServerTaintControl`**: server-level taint control, same four-button pattern.

All fetch helpers in a single `api.ts`-style section at the top of the file (following credential-store's precedent).

### Step 10: Write the stylesheet

**File:** `src/plugins/community/mcp-client/mcp-client-web-ui.css`
**Complexity:** Low
**Dependencies:** Step 9

Status badges (green=connected, yellow=failed, red=dead, grey=stopped/pending), transport badges, taint buttons (active state for the currently-selected level, distinct color per level), table layout, expandable row styling, previously-seen section greying.

### Step 11: Add the build script

**File:** `package.json`
**Complexity:** Trivial
**Dependencies:** Step 9

Add to `scripts`:

```json
"build:mcp-client-ui": "esbuild src/plugins/community/mcp-client/mcp-client-web-ui.tsx --bundle --format=esm --platform=browser --target=es2022 --tsconfig=src/plugins/system/web-ui/client/tsconfig.client.json --outfile=dist/plugins/community/mcp-client/mcp-client-web-ui.js"
```

Chain into the top-level `build` script (line 15):

```json
"build": "npm run build:server && npm run build:client && npm run build:plugin-ui && npm run build:credential-store-ui && npm run build:agents-ui && npm run build:google-apis-ui && npm run build:mcp-client-ui",
```

### Step 12: Write the browser bundle tests

**File:** `src/plugins/community/mcp-client/mcp-client-web-ui.test.ts`
**Complexity:** Medium
**Dependencies:** Steps 9, 10

Use `vi.mock` for `fetch` and test that components render the right thing given canned responses. Cover:

- `McpStatusSummary` renders "3/4 connected (0 dead)" for a 3-connected/1-failed response.
- `McpStatusSummary` polls on mount, stops on visibilitychange to hidden, resumes on visible.
- `McpServersPage` renders a row per server with the right status badge.
- `ToolList` renders active and previously-seen sections, with the right counts.
- `ToolRow` highlights the right taint button based on `overrideSource`.
- Clicking a taint button calls the right endpoint with the right body.

### Step 13: Lint, test, build, smoke test

**Complexity:** Low
**Dependencies:** Steps 1–12

```bash
npm run lint
npm test
npm run build
```

Smoke test: temp config dir with `mcp-client` enabled, one stdio server in `mcp.json`, run `ALICE_SMOKE_TEST=1`. Verify:

- Plugin loads, registers entity with memory, REST routes registered.
- Browser bundle is served at `/plugin-scripts/<id>-mcp-client-web-ui.js`.
- Opening the web UI shows the MCP status widget below the pages menu.
- Navigating to `/mcp-servers` shows the server table.
- Manually setting a taint override via `curl` to the REST endpoint causes the next `/statuses` response to show the new effective taint.

## File Changes Summary

| File                                                               | Action | Description                                                                               |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------- |
| `src/plugins/system/web-ui/client/types/index.ts`                  | Modify | Add `'settings-panel-below-nav'` to `UIRegion`                                            |
| `src/plugins/system/web-ui/client/components/SettingsPanel.tsx`    | Modify | Add `<RegionSlot region="settings-panel-below-nav" />` below pages nav                    |
| `package.json`                                                     | Modify | Add `build:mcp-client-ui` script, chain into `build`                                      |
| `src/plugins/community/mcp-client/mcp-client.ts`                   | Modify | Wire memory, REST routes, web-ui registration, extended offer                             |
| `src/plugins/community/mcp-client/server-manager.ts`               | Modify | Add `reSyncTaint`, `reconnectServer`, seen-tool upsert+sweep, effective-taint computation |
| `src/plugins/community/mcp-client/config.ts`                       | Modify | Add `seenToolRetentionDays` to schema                                                     |
| `src/plugins/community/mcp-client/types.ts`                        | Modify | Add `TaintLevel`, `SeenToolRecord`, extend `ServerStatusSnapshot`                         |
| `src/plugins/community/mcp-client/seen-tool-store.ts`              | Create | SQLite CRUD for `McpClientSeenTool`                                                       |
| `src/plugins/community/mcp-client/overrides-store.ts`              | Create | Read/write `overrides.json`, precedence resolution                                        |
| `src/plugins/community/mcp-client/routes.ts`                       | Create | 7 REST endpoints                                                                          |
| `src/plugins/community/mcp-client/db-schemas/McpClientSeenTool.ts` | Create | MikroORM entity                                                                           |
| `src/plugins/community/mcp-client/mcp-client-web-ui.tsx`           | Create | Browser bundle                                                                            |
| `src/plugins/community/mcp-client/mcp-client-web-ui.css`           | Create | Styles                                                                                    |
| `src/plugins/community/mcp-client/seen-tool-store.test.ts`         | Create | Unit tests                                                                                |
| `src/plugins/community/mcp-client/overrides-store.test.ts`         | Create | Unit tests                                                                                |
| `src/plugins/community/mcp-client/routes.test.ts`                  | Create | Unit tests                                                                                |
| `src/plugins/community/mcp-client/mcp-client-web-ui.test.ts`       | Create | Component tests                                                                           |

## Testing Strategy

### Unit tests (per-module, mocked boundaries)

- `seen-tool-store.test.ts` — upsert/sweep/list with mocked ORM (pattern from `reminders-broker.test.ts`)
- `overrides-store.test.ts` — precedence chain, persistence, schema validation, pruning
- `routes.test.ts` — REST handlers with mocked manager/store/overrides
- `mcp-client-web-ui.test.ts` — component rendering with mocked fetch

### Integration tests

- The `mcp-client.test.ts` from plan 2 is extended (not replaced) to verify: memory entity registration, ORM caching, web-ui script/stylesheet registration gated on `web-ui` availability, REST route registration gated on `rest-serve` availability, `onAssistantWillStopAcceptingRequests` runs the full sweep.

### Manual / smoke testing

1. `npm run lint && npm test && npm run build` — all green.
2. Temp config dir with `mcp-client` enabled + one stdio MCP server in `mcp.json`. `ALICE_SMOKE_TEST=1`. Verify the plugin loads, REST routes are registered, browser bundle is served.
3. With the assistant running normally, open the web UI. Verify:
   - The MCP status widget appears below the pages menu in the right-hand settings panel.
   - Clicking it navigates to `/mcp-servers`.
   - The server table renders with the configured server.
   - Expanding the server shows the active tools.
   - Changing a tool's taint via the UI updates the badge immediately (after the next poll) and the change persists across an assistant restart (verify by checking `overrides.json` on disk).
   - Killing the MCP subprocess causes the status to update to `failed` within ~5s, and the reconnect button becomes enabled.
   - Clicking reconnect brings the server back without an assistant restart.
4. Verify taint enforcement end-to-end: set a tool to `secure`, start a voice conversation (which taints the context), attempt to call the tool — it should be filtered out of the LLM's tool list. Set it back to `clean` — it should reappear on the next request.

## Definition of Done

- [ ] The `settings-panel-below-nav` region exists in core web-ui and the MCP status widget renders into it
- [ ] The `/mcp-servers` route is registered and appears in the pages nav as "MCP Servers"
- [ ] `GET /api/mcp-client/statuses` returns `ServerStatusSnapshot[]` with per-tool `effectiveTaint` and `overrideSource`
- [ ] `GET /api/mcp-client/seen-tools/:serverId` returns active + previously-seen tools within retention
- [ ] `POST /api/mcp-client/servers/:serverId/reconnect` forces a restart and returns the new status
- [ ] All four override endpoints (POST/DELETE for server and tool) persist to `overrides.json` and trigger `reSyncTaint`
- [ ] The precedence chain (per-tool > per-server-UI > per-server-mcp.json > default) is enforced and visible in the UI via `overrideSource`
- [ ] `McpClientSeenTool` entity is registered with memory; `syncTools` upserts rows and sweeps expired ones per-server
- [ ] `onAssistantWillStopAcceptingRequests` runs a full sweep across all servers
- [ ] `seenToolRetentionDays` is configurable (default 30)
- [ ] The UI polls every 5s with `visibilitychange` gating
- [ ] Server rows show status badges, restart attempts, and a working reconnect button
- [ ] Tool rows show four taint buttons (`tainted` / `clean` / `secure` / `inherit`) with the correct one highlighted per `overrideSource`
- [ ] Previously-seen tools render in a separate greyed-out section, with taint buttons still functional
- [ ] Taint changes take effect on the next LLM request (verified via manual test 4)
- [ ] Taint changes persist across assistant restarts (verified by inspecting `overrides.json` on disk)
- [ ] The plugin loads and bridges tools even when `web-ui` is disabled (R32 — UI registration is guarded)
- [ ] `npm run lint` passes
- [ ] `npm test` passes with all new test files and zero regressions
- [ ] `npm run build` succeeds including the new `build:mcp-client-ui` step
- [ ] `ALICE_SMOKE_TEST=1` run completes startup and clean shutdown with no errors
- [ ] Manual end-to-end taint enforcement test (manual test 4) passes

## Risks & Mitigations

| Risk                                                                                                                                                                                       | Impact                                                                                                                                                                                             | Mitigation                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getServerStatuses` becomes async in this plan (was sync in plan 2)                                                                                                                        | Breaking change to the plan 2 capability signature                                                                                                                                                 | This plan ships _after_ plan 2 lands, so the signature change is internal to the mcp-client plugin and doesn't affect any external consumer. The capability type is augmented via the same `declare module '../../../lib.js'` block, so downstream plugins that declared a dependency on `mcp-client` (none exist yet) would see the updated type at build time.                             |
| `reSyncTaint` unregisters-and-re-registers every tool on every override change                                                                                                             | Brief window where the server's tools are unregistered; an LLM request landing in that window sees fewer tools                                                                                     | Window is synchronous and sub-millisecond in practice (a few DTN calls). The DTN's existing uniqueness check would throw if we tried to register-then-unregister, so the order is unregister-all-then-register-all. Acceptable; the alternative (compute diffs) adds complexity for no real-world benefit at this tool count.                                                                |
| `OverridesStore.load()` reads from disk on every call (no in-memory cache)                                                                                                                 | Slight latency on every REST handler and every `syncTools`                                                                                                                                         | `overrides.json` is small (one entry per server with overrides, one nested entry per overridden tool). File reads are sub-millisecond at this size. Cache invalidation across the REST handlers and the manager would add bugs (the REST handler's write must invalidate the manager's cache, etc.); a fresh read on every call is correct and fast enough. Documented trade-off.            |
| `McpClientSeenTool` table grows unbounded if a user tries many short-lived MCP servers                                                                                                     | DB bloat                                                                                                                                                                                           | Per-server sweep on `syncTools` + full sweep on shutdown covers the normal case. A user who tries 1000 servers and never shuts down cleanly could accumulate rows; the 30-day retention still applies via the per-server sweep on the next `syncTools` for each surviving server. If this ever becomes a real problem, add a periodic full-sweep timer (deferred — not in v1).               |
| The new `settings-panel-below-nav` region is a core web-ui change                                                                                                                          | Affects every plugin that registers into `settings-panel`, even though they don't use the new region                                                                                               | The new region is purely additive: existing `settings-panel` registrations render in the same place (above the nav), and the new region just adds a slot below the nav. No existing plugin is affected. The change is two lines in `SettingsPanel.tsx` plus one type union member.                                                                                                           |
| Two REST endpoints can race: a taint override write and a `syncTools` triggered by a server's `listChanged` notification                                                                   | The `syncTools` re-registers tools with the _old_ taint (read from `overridesStore` before the REST write flushed), then the `reSyncTaint` from the REST handler re-registers with the _new_ taint | The order is: REST write → `reSyncTaint` (unregister all + register with new taint). If `syncTools` fires in between, it reads the old overrides, but `reSyncTaint` immediately overwrites. End state is correct. The intermediate state is one extra unregister/register cycle, which is harmless.                                                                                          |
| The browser bundle is built into `dist/plugins/community/mcp-client/mcp-client-web-ui.js` but the plugin registers it via `path.join(import.meta.dirname, 'mcp-client-web-ui.js')`         | If the build script's `--outfile` path doesn't match `import.meta.dirname` at runtime, the file isn't found                                                                                        | The `post-build` script in `package.json` copies `src/**/*.js` to `dist/` — but the web-ui bundle is built directly to `dist/plugins/community/mcp-client/`, which is where `import.meta.dirname` resolves to at runtime (the server-side `mcp-client.ts` is compiled to `dist/plugins/community/mcp-client/mcp-client.js`). Path alignment verified against the credential-store precedent. |
| `reSyncTaint` for the synthetic `__read_resource` and `__list_resources` tools uses `entry.taintOverride` as the mcp.json server override, but these synthetic tools have no real MCP name | Precedence resolution for synthetic tools: they can't have per-tool overrides (the UI doesn't expose them), so they always inherit from the server level                                           | Documented: `OverridesStore.resolveEffectiveTaint` is called with the synthetic tool name, but since no UI flow ever writes a per-tool override for `__read_resource` / `__list_resources`, the per-tool branch never fires and they inherit the server-level override. Correct behavior, just non-obvious.                                                                                  |

## Timeline Estimate

**~2.5–3 days**, assuming plans 1 (DTN) and 2 (mcp-client plugin) have landed first:

- Step 1 (core web-ui region): 0.25 day
- Steps 2, 3 (entity + seen-tool-store + tests): 0.5 day
- Step 4 (overrides-store + tests): 0.5 day
- Steps 5, 6 (types + server-manager extension): 0.75 day (the meatiest server-side change)
- Step 7 (REST routes + tests): 0.5 day
- Step 8 (plugin entry wiring): 0.25 day
- Steps 9, 10 (browser bundle + CSS): 1 day (largest single file)
- Steps 11, 12 (build script + component tests): 0.5 day
- Step 13 (lint, test, build, smoke): 0.25 day

**Assumptions:**

- Plans 1 and 2 have landed; the DTN API and the basic mcp-client plugin (without UI, without seen-tool DB, without overrides) are working.
- The `memory` plugin's `registerDatabaseModels` + `onDatabaseReady` pattern works as documented in the database skill for the new `McpClientSeenTool` entity.
- The existing `SettingsPanel.tsx` `RegionSlot` mechanism works for the new region without additional plumbing (it does — `RegionSlot` is generic over the region string).
- Code review happens in one round; the precedence chain, the two-storage split, and the `reSyncTaint` unregister-then-register pattern are the three spots most likely to draw feedback, and all are explicitly called out as decided per the Q&A.

**Out of plan:** the `mcp.json` editor (deferred to a future plan per Q1), OAuth flows (deferred to a future plan), and hot-reload (deferred to a future plan per Q6 in the mcp-client plan).
