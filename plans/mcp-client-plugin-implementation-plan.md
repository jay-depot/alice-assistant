# Implementation Plan: `mcp-client` Community Plugin

## Overview

Add an `mcp-client` community plugin that bridges external MCP (Model Context Protocol) servers into Alice's tool system. Each configured MCP server becomes a source of tools that Alice can call, surfaced through the Dynamic Tool Namespace (DTN) machinery delivered by the prerequisite DTN plan (`./plans/dynamic-tool-namespaces-implementation-plan.md`).

This is the second half of "The great MCP client project" notebook (`/home/unleet/Obsidian/ALICE/The great MCP client project.md`). The notebook's dependency graph — MCP client → requires DTNs → requires tool-naming overhaul — is now satisfied: the tool-naming overhaul already landed in the codebase, and the DTN plan is written and ready to implement first.

### Goals

- Connect to any number of MCP servers configured by the user, using either **stdio** (subprocess) or **Streamable HTTP** (remote) transports.
- Discover each server's tools and register them as Alice tools under a single DTN owned by `mcp-client`, with per-server namespacing (`mcp_client.<server_id>__<tool_name>`) to prevent collisions.
- Forward Alice tool calls to the corresponding MCP server, return text results to the LLM.
- Surface each server's resources as a per-server `mcp_client.<server_id>__read_resource` tool.
- Supervise stdio subprocesses with auto-restart-on-exit + backoff, mirroring the existing `voice/managed-client.ts` pattern.
- Apply the project's taint security model: every MCP-surfaced tool defaults to `tainted`, with an optional per-server `taintOverride` in config.
- Handle the inevitable tool-list churn (servers add/remove tools at runtime, stdio subprocesses die) by re-registering/unregistering through the DTN as server tool lists change.

### Non-goals (explicitly deferred to fast-follows)

- **Legacy HTTP+SSE transport.** Streamable HTTP is supported; the deprecated SSE transport is not. Servers that only speak SSE will fail with an actionable error.
- **Hot-reload of MCP server config.** Editing `mcp.json` requires an assistant restart, matching every other plugin in the project (no file-watching precedent exists in the codebase).
- **MCP prompts.** Servers can expose reusable prompt templates; Alice has its own `registerHeaderSystemPrompt` / `registerConversationType` systems and mapping MCP prompts into them is its own design exercise. Out of scope for v1.
- **Non-text tool results.** MCP tool results can include `image`, `audio`, and `resource` content blocks. Alice's `Tool.execute` returns `Promise<string>` and the conversation `tool` role message is `content: string`. v1 concatenates `text` blocks and replaces non-text blocks with a placeholder. Image support requires changing the tool-result message format across the conversation layer, which is a cross-cutting change that deserves its own plan.
- **OAuth / authenticated MCP servers.** The SDK supports bearer tokens, client credentials, and full OAuth flows for Streamable HTTP. v1 supports unauthenticated servers and bearer-token-via-env servers (tokens carried in `env`). Full OAuth is a fast-follow.
- **MCP `sampling/createMessage` requests (server asks client to run an LLM completion).** Deprecated in the spec and out of scope for v1.
- **MCP elicitation (server asks user for input mid-tool-call).** Out of scope for v1; a server that requests elicitation gets a `decline` response.
- **The `mcp-client` web UI.** A settings panel for managing `mcp.json` from the browser is a separate, follow-on plan (matches the pattern used by `credential-store`, which ships its REST routes + web UI bundle in a later pass — here we ship the engine integration first).

## Requirements Summary

| #   | Requirement                                                                                                                                                                                                                                 | Type           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| R1  | The plugin is registered in `src/plugins/system-plugins.json` as a non-required community plugin with id `mcp-client`                                                                                                                       | Functional     |
| R2  | The plugin declares a DTN via `plugin.declareDTN({ availableFor })` during its registration callback, and registers all MCP-surfaced tools through that DTN                                                                                 | Functional     |
| R3  | The plugin declares a dependency on `rest-serve` (for the eventual web UI / status routes) and on the DTN-bearing engine version; it does **not** register static tools (mutual-exclusivity invariant)                                      | Functional     |
| R4  | MCP server config lives at `~/.alice-assistant/plugin-settings/mcp-client/mcp.json` using the industry-standard `{ mcpServers: { <name>: { command, args, env } } }` schema (Claude Desktop / Cursor / VS Code compatible)                  | Functional     |
| R5  | Two transport types are supported: `stdio` (subprocess, via `StdioClientTransport`) and `streamable-http` (via `StreamableHTTPClientTransport`)                                                                                             | Functional     |
| R6  | The config file format is transport-agnostic: a server entry with `command` is treated as stdio; a server entry with `url` is treated as streamable-http. This matches the Claude Desktop convention                                        | Functional     |
| R7  | Each config entry has an `id` field (kebab-case, user-supplied); the plugin sanitizes it to snake_case for use in canonical tool names                                                                                                      | Functional     |
| R8  | Canonical tool name format: `mcp_client.<sanitized_server_id>__<sanitized_tool_name>`, where sanitization replaces any character outside `[a-z0-9_]` with `_` and lowercases                                                                | Functional     |
| R9  | Tools from multiple MCP servers never collide on canonical name, even if two servers expose a tool with the same local name                                                                                                                 | Functional     |
| R10 | Every MCP-surfaced tool defaults to `taintStatus: 'tainted'`. A server entry may set `taintOverride: 'clean' \| 'secure' \| 'tainted'` to override per-server                                                                               | Functional     |
| R11 | All enabled MCP servers are spawned (stdio) / connected (http) during `onAssistantWillAcceptRequests`, in parallel; a server that fails to start is logged and skipped without aborting the others                                          | Functional     |
| R12 | After connecting, the plugin enumerates each server's tools via `client.listTools()` (paginated) and registers each as a DTN tool with `availableFor` inherited from the DTN's declared set                                                 | Functional     |
| R13 | Each MCP server also exposes a `mcp_client.<server_id>__read_resource` tool that takes a `uri` argument and calls `client.readResource()`, returning concatenated text contents                                                             | Functional     |
| R14 | When the LLM calls an MCP-surfaced tool, the plugin forwards the call to `client.callTool({ name: <original_tool_name>, arguments })` and returns concatenated text content blocks to Alice                                                 | Functional     |
| R15 | Tool-result content blocks of type `image`, `audio`, or `resource` are replaced with a `[<type> content omitted]` placeholder in v1; only `text` blocks are forwarded to the LLM                                                            | Functional     |
| R16 | If `client.callTool()` returns `isError: true`, the plugin surfaces the tool-level error text to the LLM (does not throw) so the LLM can react                                                                                              | Functional     |
| R17 | If `client.callTool()` throws a `ProtocolError` or `SdkError`, the plugin catches it and returns `Error: <message>` as the tool result (lets the retry path handle it)                                                                      | Functional     |
| R18 | If the LLM calls a tool whose canonical name the plugin has unregistered (server died mid-request), the DTN plan's existing "Tool <name> is not recognized." path handles it gracefully                                                     | Functional     |
| R19 | The SDK's `listChanged.tools` option is enabled so the client auto-refreshes its tool cache when the server emits `notifications/tools/list_changed`; the plugin re-syncs the DTN on every refresh                                          | Functional     |
| R20 | If a stdio subprocess exits unexpectedly (non-zero / signal) during normal operation, the plugin auto-restarts it with exponential backoff (1s, 2s, 4s, … capped at 60s) for up to 5 attempts, then marks the server dead                   | Functional     |
| R21 | On shutdown (`onAssistantWillStopAcceptingRequests`), the plugin closes all MCP clients (stdio: SIGTERM → 5s → SIGKILL; http: `transport.terminateSession()` → `client.close()`)                                                            | Functional     |
| R22 | The engine's `cleanupDynamicToolNamespaces()` (delivered by the DTN plan) force-removes any MCP tools the plugin failed to unregister                                                                                                       | Functional     |
| R23 | All error messages name the offending MCP server (by id) and describe the recovery step (edit `mcp.json`, restart the assistant, check the server's stderr logs)                                                                            | Non-functional |
| R24 | The plugin works without `rest-serve` being available for its core tool-bridging function (the dependency is declared only so the future web UI can register routes; if `rest-serve` is disabled, the plugin still loads and bridges tools) | Non-functional |
| R25 | All new code is co-located with tests (`*.test.ts`), uses ESM `.js` imports, follows Prettier config, and avoids `any` in non-test code                                                                                                     | Non-functional |

### Out of Scope

- Legacy HTTP+SSE transport (Q1: stdio + streamable-http only)
- Hot-reload of `mcp.json` (Q6: restart to apply)
- MCP prompts (Q7: tools + resources only)
- Non-text tool-result content (Q8: text only with placeholders)
- OAuth / client-credentials / private-key-JWT auth (Q1 fast-follow)
- Sampling, elicitation, roots (server-initiated requests)
- A web UI for editing `mcp.json`
- Migrating any existing Alice plugin to use MCP

## Architecture & Design

### High-level flow

```
registerPlugin callback
  │
  ├── plugin.config() loads plugin-settings/mcp-client/mcp-client.json
  │     (this is the plugin's own enable/disable + availableFor config)
  │
  ├── plugin.config() also reads plugin-settings/mcp-client/mcp.json
  │     (the industry-standard { mcpServers: { ... } } file)
  │     → parsed into a ServerEntry[] in memory
  │
  ├── dtn = plugin.declareDTN({ availableFor: <from mcp-client.json> })
  │     (DTN plan delivers this; availableFor defaults to ['chat','voice','autonomy']
  │      but is user-configurable so a user can restrict MCP tools to chat-only)
  │
  ├── plugin.hooks.onAssistantWillAcceptRequests(async () => {
  │     // Eager spawn/connect all enabled servers in parallel
  │     await Promise.all(serverEntries.map(startServer))
  │   })
  │
  └── plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
        // Close all clients, unregister all tools
        await Promise.all(serverEntries.map(stopServer))
      })

startServer(entry):
  │
  ├── transport = entry.url
  │     ? new StreamableHTTPClientTransport(new URL(entry.url))
  │     : new StdioClientTransport({ command, args, env })
  │
  ├── client = new Client(
  │     { name: 'alice-mcp-client', version: '<assistant version>' },
  │     { listChanged: { tools: { onChanged: (err, tools) => syncTools(entry, tools) } } }
  │   )
  │
  ├── client.onclose = () => handleUnexpectedClose(entry)
  ├── client.onerror  = (err) => log with entry.id prefix
  │
  ├── await client.connect(transport)
  │     (throws on connect failure → caught, logged, server marked failed, no tools registered)
  │
  ├── const { tools } = await listAllTools(client)  // paginated
  │
  └── syncTools(entry, tools)
        for each mcpTool:
          dtn.registerTool({
            name: `<server_id>__<sanitize(mcpTool.name)>`,
            description: mcpTool.description ?? `MCP tool ${mcpTool.name} from server ${entry.id}`,
            systemPromptFragment: '',
            parameters: mcpTool.inputSchema as TSchema,  // MCP inputSchema is already JSON Schema; cast to TSchema
            taintStatus: entry.taintOverride ?? 'tainted',
            execute: makeExecute(entry, mcpTool),
          })
        // Also register the per-server read_resource tool
        dtn.registerTool({
          name: `<server_id>__read_resource`,
          ...,
          execute: makeReadResourceExecute(entry),
        })

handleUnexpectedClose(entry):
  │
  ├── if (entry.shuttingDown) return  // expected close during shutdown
  ├── entry.restartAttempts++
  ├── if (entry.restartAttempts > MAX_RESTARTS) {
  │     log "MCP server <id> died and exhausted restart attempts; marking dead"
  │     unregisterAllToolsForServer(entry)
  │     entry.status = 'dead'
  │     return
  │   }
  ├── const delay = Math.min(1000 * 2 ** (entry.restartAttempts - 1), 60000)
  └── setTimeout(() => startServer(entry).catch(...), delay)

syncTools(entry, newTools):
  │
  ├── compute set of new canonical names and old canonical names for this server
  ├── for each old name not in new: dtn.unregisterTool(oldName)
  ├── for each new name not in old: dtn.registerTool(...)
  └── for each present-in-both: re-register to update description/schema (cheap; avoids diff logic)
```

### Component breakdown

| Component        | File                                                   | Responsibility                                                                                                     |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Plugin entry     | `src/plugins/community/mcp-client/mcp-client.ts`       | Plugin definition, lifecycle hooks, wires the manager into Alice                                                   |
| Server manager   | `src/plugins/community/mcp-client/server-manager.ts`   | Per-server state, start/stop/restart, transport construction, tool sync                                            |
| Tool builders    | `src/plugins/community/mcp-client/tool-builders.ts`    | Pure functions that build Alice `Tool` objects from MCP tool definitions; `makeExecute`, `makeReadResourceExecute` |
| Name sanitizer   | `src/plugins/community/mcp-client/names.ts`            | `sanitizeServerId`, `sanitizeToolName`, `buildCanonicalName` — pure, fully unit-tested                             |
| Config loader    | `src/plugins/community/mcp-client/config.ts`           | Typebox schemas for `mcp-client.json` (plugin config) and `mcp.json` (server list); parsing + validation           |
| Result formatter | `src/plugins/community/mcp-client/result-formatter.ts` | Converts MCP `callTool` result content blocks into a string for Alice, with `[image content omitted]` placeholders |
| Tests            | `*.test.ts` co-located                                 | Unit tests for each module above                                                                                   |

### Data models

**`mcp-client.json` (plugin config, `~/.alice-assistant/plugin-settings/mcp-client/mcp-client.json`):**

```typescript
const McpClientPluginConfigSchema = Type.Object({
  /** Conversation types that MCP-surfaced tools will be available for. */
  availableFor: Type.Array(ConversationTypeIdSchema, {
    default: ['chat', 'voice', 'autonomy'],
  }),
  /** Cap restart attempts per server before marking it dead. */
  maxRestartAttempts: Type.Integer({ minimum: 0, default: 5 }),
  /** Cap exponential-backoff delay in ms. */
  maxRestartBackoffMs: Type.Integer({ minimum: 1000, default: 60000 }),
});
```

**`mcp.json` (server list, `~/.alice-assistant/plugin-settings/mcp-client/mcp.json`):**

Industry-standard shape. The plugin reads this file directly (not via `plugin.config()`, since that mechanism is bound to a single schema'd file). Schema:

```typescript
const McpServersConfigSchema = Type.Object({
  mcpServers: Type.Record(
    Type.String(), // server id (user-chosen)
    Type.Object({
      // stdio transport:
      command: Type.Optional(
        Type.String({
          description: 'Executable to spawn. Presence selects stdio transport.',
        })
      ),
      args: Type.Optional(Type.Array(Type.String())),
      env: Type.Optional(Type.Record(Type.String(), Type.String())),
      cwd: Type.Optional(Type.String()),
      // streamable-http transport:
      url: Type.Optional(
        Type.String({
          description:
            'Server URL. Presence selects streamable-http transport.',
        })
      ),
      // shared:
      taintOverride: Type.Optional(
        Type.Union([
          Type.Literal('clean'),
          Type.Literal('secure'),
          Type.Literal('tainted'),
        ]),
        {
          description:
            'Override the default "tainted" taint status for all tools from this server.',
        }
      ),
      enabled: Type.Optional(
        Type.Boolean({
          default: true,
          description: 'Skip this server if false.',
        })
      ),
    })
  ),
});
```

A server entry with `command` is stdio; a server entry with `url` is streamable-http; both is a config error (throw at load time with the offending server id).

**In-memory `ServerEntry` (engine-internal):**

```typescript
type ServerEntry = {
  id: string; // user-supplied, kebab-case per the config schema
  canonicalServerId: string; // sanitized snake_case, used in tool names
  transport: 'stdio' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  taintOverride?: 'clean' | 'secure' | 'tainted';
  // runtime state:
  client?: Client;
  transportInstance?: StdioClientTransport | StreamableHTTPClientTransport;
  status: 'pending' | 'connected' | 'failed' | 'dead' | 'stopped';
  restartAttempts: number;
  shuttingDown: boolean;
  registeredToolNames: Set<string>; // canonical names currently registered via the DTN
};
```

### API contracts

**Plugin capability offered to other Alice plugins:**

```typescript
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'mcp-client': {
      /**
       * Returns a snapshot of every MCP server's current status and tool list.
       * Intended for a future web UI / status panel. Read-only.
       */
      getServerStatuses: () => ServerStatusSnapshot[];
    };
  }
}

type ServerStatusSnapshot = {
  id: string;
  canonicalServerId: string;
  transport: 'stdio' | 'streamable-http';
  status: ServerEntry['status'];
  restartAttempts: number;
  tools: Array<{ canonicalName: string; mcpName: string; description: string }>;
};
```

This is a minimal read-only surface — enough for a future `mcp-client` web UI bundle to render a status table without re-querying the MCP servers. No write capabilities are offered in v1 (the user edits `mcp.json` directly and restarts).

### Interaction with existing systems

**DTN (prerequisite plan):** The plugin is the canonical first consumer of the DTN API delivered by `./plans/dynamic-tool-namespaces-implementation-plan.md`. It calls `plugin.declareDTN({ availableFor })` during registration and uses `dtn.registerTool`/`dtn.unregisterTool` at runtime as server tool lists churn. The DTN's `cleanupDynamicToolNamespaces()` (engine shutdown hook) is the safety net for any tools the plugin fails to unregister.

**Taint system:** Every MCP-surfaced tool carries `taintStatus: entry.taintOverride ?? 'tainted'`. The existing `buildLlmToolDefinitions` filter (drops `secure` tools when conversation is tainted) and `tool-executor.ts` taint-tracking apply unchanged. A user who trusts their local `filesystem` MCP server can set `taintOverride: 'clean'` to make its tools usable from voice/secure contexts; a user who wants an MCP server's actuators locked down can set `taintOverride: 'secure'`.

**Tool-call timing races (notebook snag #2):** If an MCP server dies and its tools are unregistered between an LLM request being built and a tool call being executed, the DTN plan's verified path returns `"Tool <name> is not recognized."` to the LLM. The next retry's `buildLlmToolDefinitions` won't list the removed tools. No additional handling in this plugin.

**Subprocess supervision:** Borrows the SIGTERM → 5s timeout → SIGKILL escalation pattern from `src/plugins/system/voice/managed-client.ts:stopManagedVoiceClient`. The SDK's `StdioClientTransport` already implements this internally for `client.close()`, so the plugin mostly delegates; the auto-restart logic is new and lives in `server-manager.ts`.

**No file watching:** The codebase has no `fs.watch`/`chokidar` precedent. `mcp.json` is read once at startup. Changing the server list requires an assistant restart. This matches every other plugin in the project (Q6 decision).

**`rest-serve` dependency:** Declared in `pluginMetadata.dependencies` so the future web UI can register routes, but the plugin's core tool-bridging function does not actually require `rest-serve` to be available. The `onAssistantAcceptsRequests` hook that would register REST routes is stubbed to no-op if `plugin.request('rest-serve')` returns undefined (R24).

## New Package Dependencies

| Package                     | Version           | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/sdk` | `^1.29.0`         | The official MCP TypeScript SDK. Provides `Client`, `StdioClientTransport`, `StreamableHTTPClientTransport`, and the JSON-RPC plumbing. Confirmed via `npm pack` inspection of the 1.29.0 tarball: ESM-first with `exports` mapping `./client` and `./client/stdio` and `./client/streamableHttp`, matching our import paths. Stable latest tag (1.29.0); the 2.0-alpha split into `@modelcontextprotocol/client` is unpublished and out of scope. |
| `zod`                       | `^3.25 \|\| ^4.0` | Required peer dependency of `@modelcontextprotocol/sdk`. The SDK uses it internally for JSON Schema validation and structured-content validation. Currently absent from the project's dependency tree (`npm ls zod` returns empty). Installed at the version range the SDK's peerDependencies declares.                                                                                                                                            |
| `@cfworker/json-schema`     | `^4.1.1`          | Required peer dependency of `@modelcontextprotocol/sdk` (the SDK's default JSON Schema validator is ajv, but the SDK exposes `@cfworker/json-schema` as an alternative; we install it to satisfy the peer-dep so the SDK's default validator works without us having to wire a custom one).                                                                                                                                                        |

The SDK also has runtime dependencies (`express`, `hono`, `jose`, `ajv`, `cross-spawn`, `eventsource`, `pkce-challenge`, `zod-to-json-schema`, etc.) but these are bundled as `dependencies` in the SDK's own `package.json` and will be installed transitively — we do not need to declare them ourselves.

### Import paths used by the plugin

Confirmed against the 1.29.0 `package.json` `exports` field:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
```

## Project Structure

The plugin lives at `src/plugins/community/mcp-client/`, matching the `src/plugins/{category}/{id}/{id}.ts` convention from the plugin-scaffold skill. Built-in plugins are registered in `src/plugins/system-plugins.json` (the loader reads this file — see `alice-plugin-loader.ts`). No changes to `lib.ts`'s public surface are required: the plugin consumes the DTN API (already exported by the prerequisite plan) and offers its own capability via the standard `declare module '../../../lib.js'` augmentation pattern (same as `web-search-broker`, `user-files`, `credential-store`).

### Files

| File                                                        | Action | Description                                                                                              |
| ----------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `src/plugins/community/mcp-client/mcp-client.ts`            | Create | Plugin entry: metadata, registerPlugin callback, lifecycle hooks, wiring                                 |
| `src/plugins/community/mcp-client/server-manager.ts`        | Create | `ServerManager` class: start/stop/restart all servers, per-server state, transport construction          |
| `src/plugins/community/mcp-client/tool-builders.ts`         | Create | `buildToolFromMcpTool`, `buildReadResourceTool` — pure functions returning Alice `Tool` objects          |
| `src/plugins/community/mcp-client/names.ts`                 | Create | `sanitizeServerId`, `sanitizeToolName`, `buildCanonicalToolName`                                         |
| `src/plugins/community/mcp-client/config.ts`                | Create | Typebox schemas for `mcp-client.json` and `mcp.json`; `loadServerEntries()` reads + validates `mcp.json` |
| `src/plugins/community/mcp-client/result-formatter.ts`      | Create | `formatMcpToolResult(contentBlocks): string` — concatenates text blocks, placeholders non-text           |
| `src/plugins/community/mcp-client/types.ts`                 | Create | Internal `ServerEntry`, `ServerStatusSnapshot` types                                                     |
| `src/plugins/community/mcp-client/names.test.ts`            | Create | Unit tests for sanitization (collisions, illegal chars, case folding)                                    |
| `src/plugins/community/mcp-client/result-formatter.test.ts` | Create | Unit tests for content-block formatting (text-only, mixed, all-non-text, empty)                          |
| `src/plugins/community/mcp-client/config.test.ts`           | Create | Unit tests for config parsing (stdio vs http detection, both-present error, missing file, bad json)      |
| `src/plugins/community/mcp-client/tool-builders.test.ts`    | Create | Unit tests for tool construction (description fallback, taint default + override, execute wiring)        |
| `src/plugins/community/mcp-client/server-manager.test.ts`   | Create | Unit tests for start/stop/restart with mocked `Client` and transports                                    |
| `src/plugins/community/mcp-client/mcp-client.test.ts`       | Create | Integration-style test: full plugin registration + DTN interaction with mocked SDK                       |
| `src/plugins/system-plugins.json`                           | Modify | Add the `mcp-client` entry                                                                               |

## Implementation Steps

### Step 1: Add dependencies

**File:** `package.json`
**Complexity:** Trivial
**Dependencies:** None

```bash
npm install @modelcontextprotocol/sdk@^1.29.0 zod@^3.25 @cfworker/json-schema@^4.1.1
```

Verify the install succeeds and `npm ls @modelcontextprotocol/sdk` shows `1.29.x`. Run `npm run build` to confirm the new dependency doesn't break the existing build (TypeScript strict mode, ESM, NodeNext resolution).

### Step 2: Write `names.ts` + tests

**File:** `src/plugins/community/mcp-client/names.ts`
**Complexity:** Low
**Dependencies:** Step 1

```typescript
/**
 * Sanitize a user-supplied server id or MCP tool name for inclusion in a
 * canonical Alice tool name. Lowercases, replaces any character outside
 * [a-z0-9_] with '_', and collapses runs of '_' into a single '_'.
 *
 * MCP tool names can contain dots, slashes, hyphens, and (rarely) other
 * punctuation. We collapse all of these to '_' to keep canonical names
 * safe for Ollama tool-call parsing and for the DTN's canonical-name
 * uniqueness check.
 */
export function sanitizeForToolName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || '_'
  );
}

/**
 * Build the Alice-side local tool name for an MCP tool.
 * Format: `<sanitized_server_id>__<sanitized_mcp_tool_name>`.
 * The DTN engine prepends the plugin id namespace, producing the final
 * canonical name `mcp_client.<sanitized_server_id>__<sanitized_mcp_tool_name>`.
 */
export function buildLocalToolName(
  canonicalServerId: string,
  mcpToolName: string
): string {
  return `${canonicalServerId}__${sanitizeForToolName(mcpToolName)}`;
}

/**
 * Build the Alice-side local tool name for a server's read_resource tool.
 * Constant per server; the canonical name becomes
 * `mcp_client.<sanitized_server_id>__read_resource`.
 */
export function buildReadResourceToolName(canonicalServerId: string): string {
  return `${canonicalServerId}__read_resource`;
}
```

Write `names.test.ts` covering: empty string, already-clean input, mixed case, dots/slashes/hyphens, leading/trailing underscores, two MCP tools that differ only in case folding to the same sanitized name (caller must detect collisions — documented but not silently merged).

### Step 3: Write `result-formatter.ts` + tests

**File:** `src/plugins/community/mcp-client/result-formatter.ts`
**Complexity:** Low
**Dependencies:** Step 1

```typescript
type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | {
      type: 'resource';
      resource: {
        uri: string;
        text?: string;
        blob?: string;
        mimeType?: string;
      };
    };

/**
 * Convert an MCP callTool result's content blocks into a string for Alice's
 * tool-result message. Text blocks are concatenated with newlines; non-text
 * blocks are replaced with a placeholder. v1 only — image/audio/resource
 * content support is deferred (see plan Q8).
 */
export function formatMcpToolResult(blocks: McpContentBlock[]): string {
  if (blocks.length === 0) {
    return '[MCP tool returned no content]';
  }
  return blocks
    .map(block => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'image':
          return `[image content omitted (mime: ${block.mimeType})]`;
        case 'audio':
          return `[audio content omitted (mime: ${block.mimeType})]`;
        case 'resource':
          return `[resource reference omitted (uri: ${block.resource.uri})]`;
        default:
          return `[unknown content type omitted]`;
      }
    })
    .join('\n');
}
```

Write `result-formatter.test.ts` covering: all-text, mixed text+image, all-non-text, empty array, unknown block type (defensive default arm).

### Step 4: Write `config.ts` + tests

**File:** `src/plugins/community/mcp-client/config.ts`
**Complexity:** Medium
**Dependencies:** Steps 1, 2

Define the Typebox schemas (see "Data models" above) and a `loadServerEntries(configDir)` function that:

1. Computes the path `path.join(configDir, 'plugin-settings', 'mcp-client', 'mcp.json')`.
2. If the file does not exist, returns an empty array (the plugin has no servers to manage — not an error).
3. If the file exists, reads it, JSON-parses it, validates against `McpServersConfigSchema`. On validation failure, throws with the file path and the offending server id (when locatable from the Typebox errors).
4. For each entry in `mcpServers`: validates that exactly one of `command` / `url` is present (throws with the server id if both or neither). Builds a `ServerEntry` with `canonicalServerId = sanitizeForToolName(id)`, `transport` derived from which field is present, and `status: 'pending'`.
5. Detects duplicate `canonicalServerId` values across entries (two user-chosen ids that sanitize to the same snake_case) and throws with both ids — this would cause silent tool-name collisions and is the user's bug to fix.
6. Filters out entries with `enabled: false` (default true).

Write `config.test.ts` covering: missing file (returns []), empty `mcpServers` (returns []), stdio entry, http entry, both `command` and `url` present (throws, names the server id), neither present (throws), `enabled: false` filtered out, duplicate canonical ids (throws with both ids), bad JSON (throws with file path), schema-invalid (throws with file path).

### Step 5: Write `tool-builders.ts` + tests

**File:** `src/plugins/community/mcp-client/tool-builders.ts`
**Complexity:** Medium
**Dependencies:** Steps 2, 3

```typescript
import { Type, type TSchema } from 'typebox';
import type { Tool } from '../../../lib/tool-system.js';
import { formatMcpToolResult } from './result-formatter.js';
import {
  buildLocalToolName,
  buildReadResourceToolName,
  sanitizeForToolName,
} from './names.js';
import type { ServerEntry } from './types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

type McpTool = {
  name: string;
  description?: string;
  inputSchema: object; // JSON Schema; we cast to TSchema since Typebox's TSchema is structurally JSON Schema
};

/**
 * Build an Alice Tool from an MCP tool definition. The returned Tool's
 * `name` is the *local* name (server-id-prefixed); the DTN engine will
 * stamp the final canonical name (`mcp_client.<local>`).
 *
 * `execute` closes over the ServerEntry and McpTool so it can find the
 * right Client at call time. If the server has died and the DTN has
 * unregistered the tool by then, execute is never called (the LLM gets
 * "Tool <name> is not recognized." instead).
 */
export function buildToolFromMcpTool(
  entry: ServerEntry,
  mcpTool: McpTool
): Tool {
  return {
    name: buildLocalToolName(entry.canonicalServerId, mcpTool.name),
    description:
      mcpTool.description ??
      `MCP tool "${mcpTool.name}" from server "${entry.id}".`,
    systemPromptFragment: '',
    parameters: mcpTool.inputSchema as TSchema,
    taintStatus: entry.taintOverride ?? 'tainted',
    availableFor: [], // DTN overwrites this; set to [] to make the overwrite semantics obvious
    execute: async args => {
      const client = entry.client;
      if (!client) {
        // Server died after registration but before DTN caught up — return
        // an error string the LLM can react to. The retry path won't list
        // this tool anymore, so the LLM won't re-attempt.
        return `Error: MCP server "${entry.id}" is not currently connected.`;
      }
      try {
        const result = await client.callTool({
          name: mcpTool.name, // original MCP name, NOT the Alice canonical name
          arguments: args,
        });
        if (result.isError) {
          // Tool ran but reported a failure — surface the text to the LLM.
          return formatMcpToolResult(result.content as any[]);
        }
        return formatMcpToolResult(result.content as any[]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error calling MCP tool "${mcpTool.name}" on server "${entry.id}": ${message}`;
      }
    },
  };
}

/**
 * Build the per-server read_resource tool. Takes a `uri` argument,
 * calls client.readResource, returns concatenated text contents.
 */
export function buildReadResourceTool(entry: ServerEntry): Tool {
  return {
    name: buildReadResourceToolName(entry.canonicalServerId),
    description:
      `Read a resource from MCP server "${entry.id}" by URI. ` +
      `Use ${entry.canonicalServerId}__list_resources to discover available URIs.`,
    systemPromptFragment: '',
    parameters: Type.Object({
      uri: Type.String({ description: 'The URI of the resource to read.' }),
    }),
    taintStatus: entry.taintOverride ?? 'tainted',
    availableFor: [],
    execute: async (args: { uri: string }) => {
      const client = entry.client;
      if (!client) {
        return `Error: MCP server "${entry.id}" is not currently connected.`;
      }
      try {
        const { contents } = await client.readResource({ uri: args.uri });
        // Each content is either { uri, text, mimeType? } or { uri, blob, mimeType? }.
        // v1 returns text contents as text and blob contents as a placeholder.
        const parts = contents.map((c: any) =>
          'text' in c
            ? c.text
            : `[binary resource content omitted (uri: ${c.uri}, mime: ${c.mimeType ?? 'unknown'})]`
        );
        return parts.length > 0
          ? parts.join('\n')
          : `[MCP resource "${args.uri}" returned no contents]`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error reading MCP resource "${args.uri}" on server "${entry.id}": ${message}`;
      }
    },
  };
}
```

Note: the `read_resource` tool's description references a `<server_id>__list_resources` tool. We register a list_resources tool per server too (cheap — it's just `client.listResources()` over the wire). Add a `buildListResourcesTool(entry)` following the same pattern. (This was implicit in Q7's "2 out of 3" answer — resources need both list and read to be useful.)

Write `tool-builders.test.ts` covering: description fallback when MCP tool has no description, taint default + override, execute returns formatted text on success, execute returns formatted text on `isError: true`, execute returns error string when client is null, execute catches `callTool` throw and returns error string, read-resource tool with text content, read-resource tool with blob content (placeholder), read-resource tool error path.

### Step 6: Write `types.ts`

**File:** `src/plugins/community/mcp-client/types.ts`
**Complexity:** Trivial
**Dependencies:** Step 1

Define `ServerEntry`, `ServerStatusSnapshot` as shown in "Data models". Re-export `McpTool` type alias.

### Step 7: Write `server-manager.ts` + tests

**File:** `src/plugins/community/mcp-client/server-manager.ts`
**Complexity:** High
**Dependencies:** Steps 2, 5, 6

The `ServerManager` class owns the `ServerEntry[]` array and exposes `startAll`, `stopAll`, and the per-server `syncTools`/`handleUnexpectedClose` logic. Key shape:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { DynamicToolNamespace } from '../../../lib/types/alice-plugin-interface.js';
import type { PluginLogger } from '../../../lib/plugin-logger.js';
import {
  buildToolFromMcpTool,
  buildReadResourceTool,
  buildListResourcesTool,
} from './tool-builders.js';
import type { ServerEntry } from './types.js';

export type ServerManagerConfig = {
  maxRestartAttempts: number;
  maxRestartBackoffMs: number;
};

export class ServerManager {
  private entries: ServerEntry[];
  private dtn: DynamicToolNamespace;
  private logger: PluginLogger;
  private cfg: ServerManagerConfig;

  constructor(
    entries: ServerEntry[],
    dtn: DynamicToolNamespace,
    logger: PluginLogger,
    cfg: ServerManagerConfig
  ) {
    this.entries = entries;
    this.dtn = dtn;
    this.logger = logger;
    this.cfg = cfg;
  }

  async startAll(): Promise<void> {
    await Promise.all(
      this.entries.map(entry =>
        this.startServer(entry).catch(err => {
          // startServer catches its own connect failures and marks the entry;
          // this outer catch is a safety net for unexpected throws.
          this.logger.error(
            `[mcp-client] Unexpected error starting server ${entry.id}:`,
            err
          );
        })
      )
    );
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      this.entries.map(entry =>
        this.stopServer(entry).catch(err => {
          this.logger.error(
            `[mcp-client] Error stopping server ${entry.id}:`,
            err
          );
        })
      )
    );
  }

  private async startServer(entry: ServerEntry): Promise<void> {
    entry.shuttingDown = false;
    try {
      const transport =
        entry.transport === 'stdio'
          ? new StdioClientTransport({
              command: entry.command!,
              args: entry.args,
              env: { ...process.env, ...entry.env },
              cwd: entry.cwd,
              stderr: 'pipe', // capture stderr for diagnostics
            })
          : new StreamableHTTPClientTransport(new URL(entry.url!));

      const client = new Client(
        { name: 'alice-mcp-client', version: '<assistant version>' },
        {
          listChanged: {
            tools: {
              onChanged: (error, tools) => {
                if (error) {
                  this.logger.warn(
                    `[mcp-client] listChanged refresh failed for ${entry.id}:`,
                    error
                  );
                  return;
                }
                this.syncTools(entry, tools ?? []).catch(err => {
                  this.logger.error(
                    `[mcp-client] syncTools failed for ${entry.id}:`,
                    err
                  );
                });
              },
            },
          },
        }
      );

      client.onclose = () => {
        if (entry.shuttingDown) return; // expected close during shutdown
        this.handleUnexpectedClose(entry);
      };
      client.onerror = (err: Error) => {
        this.logger.warn(
          `[mcp-client] transport error for ${entry.id}: ${err.message}`
        );
      };

      // For stdio, surface stderr through the plugin logger for diagnostics.
      if (entry.transport === 'stdio') {
        const stderrStream = (transport as StdioClientTransport).stderr;
        if (stderrStream) {
          stderrStream.on('data', chunk => {
            this.logger.log(`[mcp-client/${entry.id} stderr] ${String(chunk)}`);
          });
        }
      }

      await client.connect(transport);
      entry.client = client;
      entry.transportInstance = transport as any;
      entry.status = 'connected';
      entry.restartAttempts = 0;

      // Initial tool sync.
      const allTools: McpTool[] = [];
      let cursor: string | undefined;
      do {
        const { tools, nextCursor } = await client.listTools({ cursor });
        allTools.push(...(tools as McpTool[]));
        cursor = nextCursor;
      } while (cursor);

      await this.syncTools(entry, allTools);
      this.logger.log(
        `[mcp-client] Connected to server "${entry.id}" (${allTools.length} tools).`
      );
    } catch (err) {
      entry.status = 'failed';
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[mcp-client] Failed to connect to server "${entry.id}": ${message}. ` +
          `Edit ~/.alice-assistant/plugin-settings/mcp-client/mcp.json and restart to retry.`
      );
    }
  }

  private async syncTools(
    entry: ServerEntry,
    mcpTools: McpTool[]
  ): Promise<void> {
    const newCanonicalLocalNames = new Set<string>();
    const toolsToRegister: Tool[] = [];

    for (const mcpTool of mcpTools) {
      const localName = buildLocalToolName(
        entry.canonicalServerId,
        mcpTool.name
      );
      newCanonicalLocalNames.add(localName);
      toolsToRegister.push(buildToolFromMcpTool(entry, mcpTool));
    }

    // Always register read_resource and list_resources for the server.
    const readResourceName = buildReadResourceToolName(entry.canonicalServerId);
    const listResourcesName = buildListResourcesToolName(
      entry.canonicalServerId
    );
    toolsToRegister.push(buildReadResourceTool(entry));
    toolsToRegister.push(buildListResourcesTool(entry));
    newCanonicalLocalNames.add(readResourceName);
    newCanonicalLocalNames.add(listResourcesName);

    // Unregister tools that are no longer present.
    for (const oldLocalName of [...entry.registeredToolNames]) {
      if (!newCanonicalLocalNames.has(oldLocalName)) {
        // Reconstruct the canonical name: mcp_client.<localName>
        this.dtn.unregisterTool(`mcp_client.${oldLocalName}`);
        entry.registeredToolNames.delete(oldLocalName);
      }
    }

    // Register new tools. Re-registering existing ones is cheap and avoids
    // a per-tool diff; the DTN's canonical-name uniqueness check would throw
    // on a duplicate, so we unregister-then-register for tools that already
    // existed (description/schema may have changed).
    for (const tool of toolsToRegister) {
      const canonical = `mcp_client.${tool.name}`;
      if (entry.registeredToolNames.has(tool.name)) {
        this.dtn.unregisterTool(canonical);
      }
      this.dtn.registerTool(tool);
      entry.registeredToolNames.add(tool.name);
    }
  }

  private handleUnexpectedClose(entry: ServerEntry): void {
    if (entry.shuttingDown || entry.status === 'stopped') return;
    entry.client = undefined;
    entry.transportInstance = undefined;
    entry.status = 'failed';

    // Unregister all this server's tools immediately so the LLM stops seeing them.
    for (const localName of entry.registeredToolNames) {
      this.dtn.unregisterTool(`mcp_client.${localName}`);
    }
    entry.registeredToolNames.clear();

    if (entry.restartAttempts >= this.cfg.maxRestartAttempts) {
      entry.status = 'dead';
      this.logger.error(
        `[mcp-client] Server "${entry.id}" died and exhausted ${this.cfg.maxRestartAttempts} restart attempts. ` +
          `Marking dead. Restart the assistant to retry, or check the server's stderr logs above for the cause.`
      );
      return;
    }

    entry.restartAttempts += 1;
    const delay = Math.min(
      1000 * 2 ** (entry.restartAttempts - 1),
      this.cfg.maxRestartBackoffMs
    );
    this.logger.warn(
      `[mcp-client] Server "${entry.id}" closed unexpectedly. ` +
        `Auto-restart attempt ${entry.restartAttempts}/${this.cfg.maxRestartAttempts} in ${delay}ms.`
    );
    setTimeout(() => {
      this.startServer(entry).catch(err => {
        this.logger.error(
          `[mcp-client] Restart attempt ${entry.restartAttempts} for "${entry.id}" failed:`,
          err
        );
      });
    }, delay);
  }

  private async stopServer(entry: ServerEntry): Promise<void> {
    entry.shuttingDown = true;
    const client = entry.client;
    entry.client = undefined;
    entry.transportInstance = undefined;
    if (!client) {
      entry.status = 'stopped';
      return;
    }
    try {
      // For streamable-http, terminate the server-side session first (recommended by the SDK docs).
      if (entry.transport === 'streamable-http') {
        const transport =
          entry.transportInstance as StreamableHTTPClientTransport;
        try {
          await transport.terminateSession();
        } catch {
          /* best-effort */
        }
      }
      await client.close(); // SDK handles SIGTERM→SIGKILL for stdio internally
    } catch (err) {
      this.logger.warn(
        `[mcp-client] Error closing client for "${entry.id}":`,
        err
      );
    }
    // Unregister all this server's tools.
    for (const localName of entry.registeredToolNames) {
      this.dtn.unregisterTool(`mcp_client.${localName}`);
    }
    entry.registeredToolNames.clear();
    entry.status = 'stopped';
  }

  getServerStatuses(): ServerStatusSnapshot[] {
    return this.entries.map(entry => ({
      id: entry.id,
      canonicalServerId: entry.canonicalServerId,
      transport: entry.transport,
      status: entry.status,
      restartAttempts: entry.restartAttempts,
      tools: [], // populated by a future web UI; we don't track descriptions here to keep the entry lean
    }));
  }
}
```

Write `server-manager.test.ts` with the `Client` and transports mocked via `vi.mock('@modelcontextprotocol/sdk/client/index.js')` etc. Cover:

- `startAll` with two stdio servers, both connect, both sync tools → both connected.
- `startAll` with one server whose `connect` rejects → that server marked `failed`, the other still connects.
- `syncTools` happy path: 3 tools + read_resource + list_resources registered, canonical names correct.
- `syncTools` on a refresh where one tool was removed → that tool unregistered, others unchanged.
- `syncTools` on a refresh where one tool's description changed → unregister-then-register (verify call order via mock spies).
- `handleUnexpectedClose` with attempts under the cap → schedules a restart (use `vi.useFakeTimers`).
- `handleUnexpectedClose` at the cap → marks `dead`, no restart scheduled.
- `stopServer` unregisters all tools and sets `status: 'stopped'`.
- `stopAll` calls `stopServer` for every entry.
- `client.onclose` fires during normal operation (not shutting down) → triggers `handleUnexpectedClose`.
- `client.onclose` fires during shutdown → ignored.

### Step 8: Write the plugin entry `mcp-client.ts`

**File:** `src/plugins/community/mcp-client/mcp-client.ts`
**Complexity:** Medium
**Dependencies:** Steps 4, 7

```typescript
import { Type } from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import { loadServerEntries } from './config.js';
import { ServerManager } from './server-manager.js';
import { UserConfig } from '../../../lib/user-config.js';

const McpClientPluginConfigSchema = Type.Object({
  availableFor: Type.Array(Type.String(), {
    default: ['chat', 'voice', 'autonomy'],
    description:
      'Conversation types that MCP-surfaced tools will be available for.',
  }),
  maxRestartAttempts: Type.Integer({ minimum: 0, default: 5 }),
  maxRestartBackoffMs: Type.Integer({ minimum: 1000, default: 60000 }),
});

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'mcp-client': {
      getServerStatuses: () => ReturnType<ServerManager['getServerStatuses']>;
    };
  }
}

const mcpClientPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'mcp-client',
    name: 'MCP Client',
    brandColor: '#7c3aed',
    description:
      "Bridges external MCP (Model Context Protocol) servers into the assistant's " +
      'tool system. Each configured MCP server becomes a source of tools the assistant ' +
      'can call. Configure servers in ~/.alice-assistant/plugin-settings/mcp-client/mcp.json ' +
      'using the industry-standard { mcpServers: { ... } } format. Disabled by default — ' +
      'enable in plugin-settings/enabled-plugins.json after configuring servers.',
    version: 'LATEST',
    dependencies: [{ id: 'rest-serve', version: 'LATEST' }],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config(McpClientPluginConfigSchema, {
      availableFor: ['chat', 'voice', 'autonomy'],
      maxRestartAttempts: 5,
      maxRestartBackoffMs: 60000,
    });

    const pluginConfig = config.getPluginConfig();
    const configDir = UserConfig.getConfigPath();
    const serverEntries = loadServerEntries(configDir);

    plugin.logger.log(
      `registerPlugin: Loaded ${serverEntries.length} MCP server entry/entries from config.`
    );

    // Declare the DTN up-front. Every MCP-surfaced tool registers through this.
    const dtn = plugin.declareDTN({
      availableFor: pluginConfig.availableFor,
    });

    const manager = new ServerManager(serverEntries, dtn, plugin.logger, {
      maxRestartAttempts: pluginConfig.maxRestartAttempts,
      maxRestartBackoffMs: pluginConfig.maxRestartBackoffMs,
    });

    plugin.offer<'mcp-client'>({
      getServerStatuses: () => manager.getServerStatuses(),
    });

    plugin.hooks.onAssistantWillAcceptRequests(async () => {
      plugin.logger.log(
        'onAssistantWillAcceptRequests: Starting MCP server connections.'
      );
      await manager.startAll();
      plugin.logger.log(
        'onAssistantWillAcceptRequests: Completed MCP server startup.'
      );
    });

    plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
      plugin.logger.log(
        'onAssistantWillStopAcceptingRequests: Stopping MCP servers.'
      );
      await manager.stopAll();
      plugin.logger.log(
        'onAssistantWillStopAcceptingRequests: Completed MCP server shutdown.'
      );
    });
  },
};

export default mcpClientPlugin;
```

### Step 9: Register in `system-plugins.json`

**File:** `src/plugins/system-plugins.json`
**Complexity:** Trivial
**Dependencies:** Step 8

Add an entry (alphabetical-ish position, near the other community plugins):

```json
{
  "id": "mcp-client",
  "name": "MCP Client",
  "category": "community",
  "required": false
}
```

### Step 10: Integration test `mcp-client.test.ts`

**File:** `src/plugins/community/mcp-client/mcp-client.test.ts`
**Complexity:** Medium
**Dependencies:** Steps 8, 9

This test exercises the plugin's registration and hook wiring with the DTN engine mocked at the boundary (since the real DTN engine is delivered by the prerequisite plan and has its own test suite). Cover:

- Plugin registers without throwing when `mcp.json` doesn't exist (zero servers).
- Plugin declares a DTN during registration (verify `plugin.declareDTN` was called with the right `availableFor`).
- `onAssistantWillAcceptRequests` calls `manager.startAll()` (mock the manager).
- `onAssistantWillStopAcceptingRequests` calls `manager.stopAll()`.
- `offer` is called with a `getServerStatuses` function.
- The plugin loads even when `rest-serve` is not available (R24) — mock `plugin.request('rest-serve')` to return undefined and verify no throw.

### Step 11: Lint, test, build, smoke test

**Complexity:** Low
**Dependencies:** Steps 1–10

```bash
npm run lint
npm test
npm run build
```

Smoke test: create a temp config dir with `mcp-client` enabled and a minimal `mcp.json` pointing at a stdio MCP server that's easy to run (e.g. `npx -y @modelcontextprotocol/server-everything` if available, or a tiny inline Node script that implements the MCP server protocol over stdio). Run with `ALICE_SMOKE_TEST=1`:

```bash
ALICE_CONFIG_DIR=/tmp/alice-mcp-smoke ALICE_SMOKE_TEST=1 npm start
```

Verify in the logs:

- Plugin loads and registers the DTN.
- `onAssistantWillAcceptRequests` connects to the configured server.
- Tools are registered via the DTN (visible in the available-tool log).
- `onAssistantWillStopAcceptingRequests` closes the client and unregisters tools.
- `cleanupDynamicToolNamespaces()` runs at shutdown (from the DTN plan) and finds nothing left to clean up (proving the plugin cleaned up after itself).

Per `AGENTS.md`, first verify the fallback model in the temp `alice.json` is pulled locally with `ollama list` (default scaffold uses `qwen2:7b`).

## File Changes Summary

| File                                                        | Action | Description                                                                     |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `package.json`                                              | Modify | Add `@modelcontextprotocol/sdk`, `zod`, `@cfworker/json-schema` to dependencies |
| `src/plugins/system-plugins.json`                           | Modify | Add `mcp-client` entry (community, not required)                                |
| `src/plugins/community/mcp-client/mcp-client.ts`            | Create | Plugin entry: metadata, registration, lifecycle hooks                           |
| `src/plugins/community/mcp-client/server-manager.ts`        | Create | `ServerManager` class: start/stop/restart/sync                                  |
| `src/plugins/community/mcp-client/tool-builders.ts`         | Create | `buildToolFromMcpTool`, `buildReadResourceTool`, `buildListResourcesTool`       |
| `src/plugins/community/mcp-client/names.ts`                 | Create | Sanitization + canonical-name helpers                                           |
| `src/plugins/community/mcp-client/config.ts`                | Create | Typebox schemas + `loadServerEntries`                                           |
| `src/plugins/community/mcp-client/result-formatter.ts`      | Create | MCP content-block → string formatter                                            |
| `src/plugins/community/mcp-client/types.ts`                 | Create | `ServerEntry`, `ServerStatusSnapshot`                                           |
| `src/plugins/community/mcp-client/names.test.ts`            | Create | Sanitization unit tests                                                         |
| `src/plugins/community/mcp-client/result-formatter.test.ts` | Create | Formatter unit tests                                                            |
| `src/plugins/community/mcp-client/config.test.ts`           | Create | Config parsing unit tests                                                       |
| `src/plugins/community/mcp-client/tool-builders.test.ts`    | Create | Tool-builder unit tests                                                         |
| `src/plugins/community/mcp-client/server-manager.test.ts`   | Create | Server-manager unit tests (mocked SDK)                                          |
| `src/plugins/community/mcp-client/mcp-client.test.ts`       | Create | Plugin integration test (mocked DTN + manager)                                  |

## Testing Strategy

### Unit tests (per-module, mocked boundaries)

- `names.test.ts` — sanitization edge cases, collision behavior
- `result-formatter.test.ts` — content-block formatting
- `config.test.ts` — file loading, transport detection, duplicate-id detection
- `tool-builders.test.ts` — tool construction, taint default/override, execute paths (success, `isError`, null client, throw)
- `server-manager.test.ts` — `vi.mock` the entire `@modelcontextprotocol/sdk/client/*` surface; verify start/stop/restart/sync call sequences against DTN mock spies
- `mcp-client.test.ts` — plugin registration + hook wiring with mocked manager and DTN

### Integration tests

- No new integration test beyond `mcp-client.test.ts`. The conversation-layer integration (LLM emits a tool call for an MCP-surfaced tool, `tool-executor.ts` finds it in `tools[]`, dispatches to the `execute` closure, which calls the real MCP client) is exercised end-to-end only by the manual smoke test, because it requires a real or mock MCP server process.

### Manual / smoke testing

1. `npm run lint && npm test && npm run build` — all green.
2. Create `/tmp/alice-mcp-smoke` config dir, enable `mcp-client` in `enabled-plugins.json`, write a minimal `plugin-settings/mcp-client/mcp.json` with one stdio server entry pointing at a runnable MCP server. Run `ALICE_SMOKE_TEST=1`. Verify startup + clean shutdown with no errors and the expected log lines.
3. With the assistant running normally (not smoke test), start a chat, ask a question that the configured MCP server's tools can help with, verify the LLM calls the MCP-surfaced tool and receives a text result.
4. Kill the MCP server subprocess manually (`kill <pid>`). Verify the plugin's `onclose` fires, the auto-restart backoff kicks in, the server reconnects, and the tools re-register. Verify that during the brief window when the tools were unregistered, an LLM tool call for one of them returns "Tool <name> is not recognized." (the graceful race-handling path).

## Definition of Done

- [ ] `mcp-client` is registered in `src/plugins/system-plugins.json` and loads without errors when enabled
- [ ] Plugin declares a DTN via `plugin.declareDTN({ availableFor })` and registers no static tools (mutual-exclusivity respected)
- [ ] `mcp.json` at `~/.alice-assistant/plugin-settings/mcp-client/mcp.json` is read and validated; missing file = zero servers (not an error)
- [ ] A server entry with `command` is spawned via `StdioClientTransport`; a server entry with `url` is connected via `StreamableHTTPClientTransport`; both present throws with the server id
- [ ] Canonical tool names follow `mcp_client.<sanitized_server_id>__<sanitized_tool_name>`; collisions across servers are prevented by per-server namespacing
- [ ] Tools from two MCP servers that share a local tool name (e.g. both expose `read`) produce distinct canonical names
- [ ] Every MCP-surfaced tool defaults to `taintStatus: 'tainted'`; a server with `taintOverride: 'clean'` produces `clean` tools; `taintOverride: 'secure'` produces `secure` tools
- [ ] `onAssistantWillAcceptRequests` connects all enabled servers in parallel; a single server's connect failure is logged and skipped without aborting the others
- [ ] After connecting, each server's tools are enumerated (paginated) and registered via the DTN; a per-server `read_resource` and `list_resources` tool are also registered
- [ ] When the LLM calls an MCP-surfaced tool, the plugin forwards to `client.callTool` with the original MCP tool name and returns concatenated text content blocks
- [ ] Non-text content blocks (`image`, `audio`, `resource`) are replaced with `[<type> content omitted]` placeholders
- [ ] `client.callTool` returning `isError: true` surfaces the error text to the LLM (does not throw)
- [ ] `client.callTool` throwing a `ProtocolError`/`SdkError` is caught and returned as `Error: <message>` to the LLM
- [ ] SDK `listChanged.tools` is enabled; when a server emits `notifications/tools/list_changed`, the plugin re-syncs the DTN (registers new tools, unregisters removed ones)
- [ ] A stdio subprocess that exits unexpectedly triggers auto-restart with exponential backoff (1s→2s→4s→…→60s cap) for up to `maxRestartAttempts` (default 5), then marks the server dead
- [ ] During auto-restart, the server's tools are unregistered so the LLM stops seeing them; on reconnect they re-register
- [ ] `onAssistantWillStopAcceptingRequests` closes all clients (stdio: SIGTERM→5s→SIGKILL via SDK; http: `terminateSession`→`close`), unregisters all tools, sets status to `stopped`
- [ ] The DTN engine's `cleanupDynamicToolNamespaces()` at shutdown finds nothing to clean up (plugin cleaned up after itself) — verified in smoke test
- [ ] The plugin loads and bridges tools even when `rest-serve` is disabled (R24)
- [ ] All error messages name the offending MCP server by id and describe the recovery step
- [ ] `npm run lint` passes
- [ ] `npm test` passes with all new test files included and zero regressions
- [ ] `npm run build` succeeds (TypeScript strict mode + the new SDK dependency)
- [ ] `ALICE_SMOKE_TEST=1` run against a temp config with one stdio MCP server completes startup and clean shutdown with no errors
- [ ] Manual chat test: LLM calls an MCP-surfaced tool and receives a text result
- [ ] Manual kill test: killing the MCP subprocess triggers auto-restart; during the unregistered window, an LLM tool call returns "Tool <name> is not recognized."

## Risks & Mitigations

| Risk                                                                                                                                                                                                 | Impact                                                                                                   | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP SDK 1.29.0 has a peer dep on `zod` which isn't currently in the project                                                                                                                          | Build fails on `npm install` or runtime `Cannot find module 'zod'`                                       | Install `zod@^3.25` explicitly as a direct dependency alongside the SDK. Verified via `npm pack` inspection: SDK's `peerDependencies` declares `zod: "^3.25 \|\| ^4.0"`.                                                                                                                                                                                                                                                                                                                          |
| SDK 2.0-alpha is published on npm as `@modelcontextprotocol/client` and `@modelcontextprotocol/server`; if we accidentally `npm install` those instead of `@modelcontextprotocol/sdk`, imports break | Build fails at import resolution                                                                         | Plan explicitly pins `@modelcontextprotocol/sdk@^1.29.0` and the import paths (`@modelcontextprotocol/sdk/client/index.js` etc.) are verified against the 1.29.0 tarball's `package.json` `exports` field.                                                                                                                                                                                                                                                                                        |
| Two MCP servers expose tools with names that sanitize to the same `<server_id>__<tool_name>` (e.g. server id `my-server` and `my_server` both have a `read` tool)                                    | Silent tool-name collision — one tool shadows the other in the DTN                                       | `config.ts` detects duplicate `canonicalServerId` values across entries at load time and throws with both user-facing ids (the user's bug to fix). Within a single server, MCP tool names are unique by spec.                                                                                                                                                                                                                                                                                     |
| An MCP server's `inputSchema` is not a valid Typebox `TSchema` (the SDK hands back a plain JSON Schema object)                                                                                       | Tool registration or LLM call fails on schema validation                                                 | Cast `mcpTool.inputSchema as TSchema` — Typebox's `TSchema` is structurally a JSON Schema object with a `[typeBoxSymbol]` brand, but the brand is only enforced at the type level, not runtime. The Ollama tool-definition builder in `tool-system.ts` passes the schema through to the LLM as-is, so a plain JSON Schema object works. Documented in `tool-builders.ts` with a comment. If a real incompatibility surfaces, the fix is to wrap the schema in `Type.Unsafe(mcpTool.inputSchema)`. |
| An MCP server dies between the LLM building its tool list and a tool call being executed                                                                                                             | One wasted LLM turn, "Tool <name> is not recognized." returned                                           | Already handled by the DTN plan's verified `tool-executor.ts` path (notebook snag #2). The plugin's `handleUnexpectedClose` unregisters tools on close so the next request won't list them. No additional handling in this plugin.                                                                                                                                                                                                                                                                |
| `listChanged.tools` fires while a previous `syncTools` is still running (rapid tool-list churn)                                                                                                      | Race in `registeredToolNames` set mutation                                                               | `syncTools` is `async`; Node is single-threaded so the set mutations themselves are atomic, but two overlapping `syncTools` calls could double-register. Mitigation: add a per-server `syncInProgress` boolean gate in `ServerEntry`; if a sync is in progress when a second `listChanged` fires, set a `syncPending` flag and re-run after the first completes. Implement in Step 7.                                                                                                             |
| An MCP server's stdio subprocess spawns a long-running background process that outlives `client.close()`                                                                                             | Orphan process after shutdown                                                                            | The SDK's `StdioClientTransport.close()` sends SIGTERM then SIGKILL after a timeout to the immediate child. If the child spawns grandchildren, they may survive. Documented limitation; user can use `process.exit()` (which the assistant does at the end of shutdown) to clean up. No fix in v1.                                                                                                                                                                                                |
| The plugin's `execute` closures hold a reference to `entry.client`, which is set to `undefined` on close; a tool call in flight when the server closes could NPE                                     | Tool call throws instead of returning graceful error                                                     | `execute` checks `if (!client)` at the top and returns an error string. The check is synchronous so it's atomic with the close handler's `entry.client = undefined` assignment in Node's single-threaded model.                                                                                                                                                                                                                                                                                   |
| The `rest-serve` dependency is declared but the plugin doesn't use it in v1                                                                                                                          | Plugin fails to load if `rest-serve` is disabled, even though the plugin's core function doesn't need it | The dependency in `pluginMetadata.dependencies` is required by the engine — `rest-serve` is `required: true` in `system-plugins.json` so it's always loaded. The plugin's `registerPlugin` does not call `plugin.request('rest-serve')` in v1, so even if it were optional the plugin would load. R24 is satisfied trivially. If we later make the dependency optional, add a guard.                                                                                                              |
| SDK version 1.29.0 is 3 months old at planning time; a newer 1.x or the 2.0 split could land before this plan ships                                                                                  | Import paths or API surface drift                                                                        | Plan pins `^1.29.0`. The 2.0-alpha is published as `@modelcontextprotocol/client@2.0.0-alpha.2` — a _different package name_ — so `^1.29.0` on `@modelcontextprotocol/sdk` will not accidentally pull the 2.0 split. A future migration to 2.0 is a separate plan.                                                                                                                                                                                                                                |

## Timeline Estimate

**~2.5–3 days**, assuming the DTN plan has landed first and the MCP SDK installs cleanly:

- Step 1 (deps + build verify): 0.25 day
- Steps 2, 3 (names + result-formatter + tests): 0.5 day
- Step 4 (config + tests): 0.5 day
- Step 5 (tool-builders + tests): 0.5 day
- Step 7 (server-manager + tests): 1 day (the meatiest module)
- Steps 6, 8, 9, 10 (types, plugin entry, registry, integration test): 0.5 day
- Step 11 (lint, test, build, smoke): 0.25 day

**Assumptions:**

- The DTN plan (`./plans/dynamic-tool-namespaces-implementation-plan.md`) has landed and its `cleanupDynamicToolNamespaces()` is wired into `alice-core.ts`.
- `@modelcontextprotocol/sdk@1.29.0` installs cleanly on Node 22+ with the project's existing TypeScript 5.9 / ESM / NodeNext setup.
- A runnable stdio MCP server is available for the smoke test (e.g. `npx -y @modelcontextprotocol/server-everything` or an inline Node script).
- Code review happens in one round; the per-server namespacing format and the text-only-result decision are the two spots most likely to draw feedback, and both are explicitly called out as decided per the Q&A.

**Out of plan:** the `mcp-client` web UI bundle (settings panel + status table), which is a separate follow-on plan matching the `credential-store` precedent (engine integration first, UI bundle later).
