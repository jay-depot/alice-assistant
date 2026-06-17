# Implementation Plan: Dynamic Tool Namespaces (DTNs)

## Overview

Add a "Dynamic Tool Namespace" (DTN) capability to the plugin engine. A DTN lets a plugin own a tool namespace whose contents can change at runtime — tools appear and disappear after plugin registration has closed, in response to external events (an MCP server connecting, a service exposing a new capability, a user toggling a feature, etc.).

The first consumer of DTNs will be the planned `mcp-client` community plugin (tracked separately, see `plans/mcp-client-plugin-implementation-plan.md` and `plans/mcp-client-web-ui-implementation-plan.md`), which will translate the tools offered by each connected MCP server into Alice tools under an `mcp_client.\*` namespace. That plugin is **out of scope** for this plan — this plan delivers the engine support that makes it possible.

### Why this exists

Today, all tools are registered statically during a plugin's registration callback, gated by `assertRegistrationOpen()` in `alice-plugin-engine.ts`. The list of tools the LLM is offered is computed once per LLM request via `getTools(conversationType)` over a fixed array. There is no way for a plugin to add or remove tools after registration has closed — which is exactly what MCP servers (and any other lazily-discovered tool source) require.

### Key architectural decision

**First pass enforces a strict mutual-exclusivity rule:** a plugin may register **static tools** via `plugin.registerTool()`, **or** declare itself the owner of a DTN via `plugin.declareDTN()`, but not both. This is called out in the source notebook as a decision that will "likely crystallize into a permanent architectural decision over time." The engine throws immediately on any violation, with an actionable error message.

### Non-goals (explicitly deferred)

- Per-tool `availableFor` filtering inside a DTN. The DTN declares a single set of conversation types at `declareDTN()` time and every tool registered through it inherits that set. The shape of the DTN API leaves room to add per-tool filtering later without breaking consumers, but it is **not implemented in this plan**. (Notebook Q2.)
- The `mcp-client` plugin itself. That is a separate, follow-on plan that depends on this one landing.
- Hot-loading/unloading entire plugins. The "Future plans" comment in `alice-plugin-engine.ts` (`hotLoadPlugin`, `unloadPlugin`) is unchanged by this work.
- Migrating any existing static-tool plugin to DTNs. DTNs are an opt-in capability for plugins that need runtime tool churn; existing plugins keep using static registration.

## Requirements Summary

| #   | Requirement                                                                                                                                                                                                                     | Type           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| R1  | A plugin can call `plugin.declareDTN(options)` during its registration callback to obtain a plugin-scoped DTN object                                                                                                            | Functional     |
| R2  | The DTN object exposes `registerTool(tool)` (returns the canonical tool name) and `unregisterTool(canonicalName)` methods, callable at any time                                                                                 | Functional     |
| R3  | A plugin that has registered any static tool via `plugin.registerTool()` and then calls `declareDTN()` throws immediately                                                                                                       | Functional     |
| R4  | A plugin that has called `declareDTN()` and then attempts `plugin.registerTool()` throws immediately                                                                                                                            | Functional     |
| R5  | A plugin that calls `declareDTN()` more than once throws immediately                                                                                                                                                            | Functional     |
| R6  | `declareDTN()` may only be called during the registration callback (`assertRegistrationOpen`)                                                                                                                                   | Functional     |
| R7  | The DTN object's `registerTool`/`unregisterTool` are **not** gated by `assertRegistrationOpen` and may be called any time after registration closes                                                                             | Functional     |
| R8  | Tools registered through a DTN participate in all existing tool machinery: `getTools`, `buildLlmToolDefinitions`, `hasTool`, `hasToolByCanonicalName`, tool-call matching, taint/secure semantics, and tool-call event dispatch | Functional     |
| R9  | The DTN declares a set of conversation types at `declareDTN()` time; every tool registered through the DTN inherits that `availableFor`                                                                                         | Functional     |
| R10 | A plugin that owns a conversation type can attach a DTN's entire namespace to that conversation type via `plugin.addToolNamespaceToConversationType(conversationTypeId, sourcePluginId)`                                        | Functional     |
| R11 | `addToolNamespaceToConversationType` is resolved at runtime: newly registered DTN tools appear for the linked conversation type without further calls, and unregistering a DTN tool removes it from all linked types            | Functional     |
| R12 | DTN `registerTool` enforces canonical-name uniqueness against the same registry used by static `registerTool` (collisions throw)                                                                                                | Functional     |
| R13 | `unregisterTool` on an unknown canonical name is a no-op (does not throw) — robust against removal-then-call races                                                                                                              | Functional     |
| R14 | When the LLM calls a tool that no longer exists (DTN removed it mid-request), the existing tool-executor path returns `"Tool <name> is not recognized."` to the LLM, which lets the retry path recover naturally                | Functional     |
| R15 | The engine force-unregisters all DTN-owned tools and disposes DTNs during shutdown (mirrors `cleanupWebSocketServers()`)                                                                                                        | Functional     |
| R16 | All error messages name the offending plugin and describe the recovery step (disable the plugin or change the conflicting name)                                                                                                 | Non-functional |
| R17 | Existing static-tool plugins and their tests continue to work without modification                                                                                                                                              | Non-functional |
| R18 | New code is co-located with tests (`*.test.ts` in the same directory) and follows the project's ESM / `.js`-import / Prettier conventions                                                                                       | Non-functional |

### Out of Scope

- The `mcp-client` plugin (separate plan)
- Per-tool `availableFor` overrides inside a DTN (Notebook Q2 — deferred; API shape leaves room)
- The "simplifying pass" over existing tool names flagged in the notebook (e.g. `systemHealthCheck`, `obsidianActiveNote`, `personality-facets`). That is a separate cleanup pass and not a prerequisite for DTNs.
- Migrating any existing plugin to a DTN
- Hot-loading/unloading entire plugins

## Architecture & Design

### High-level flow

```
Plugin registration callback
  │
  ├── plugin.registerTool(tool)         ◀── static path (unchanged)
  │       stamps canonicalName, pushes to tools[]
  │
  └── plugin.declareDTN(options)        ◀── NEW dynamic path
          validates mutual exclusivity (throws if any static tool already registered
                                        by this plugin, or DTN already declared)
          returns a DTN object (plugin-scoped)
          │
          ├── dtn.registerTool(tool)    callable any time (NOT gated by assertRegistrationOpen)
          │       stamps canonicalName (plugin_id.tool_name), validates uniqueness,
          │       stamps availableFor = dtn's declared set,
          │       pushes to tools[], returns canonicalName
          │
          ├── dtn.unregisterTool(canonicalName)
          │       removes from tools[] and canonical-name registry,
          │       removes from any conversation-type associations made via the DTN,
          │       no-op if not found
          │
          └── (the DTN object itself is tracked by the engine for cleanup)

Post-registration (init-time AND runtime):
  │
  ├── pendingToolNamespaceLinks (NEW, resolved at init AND checked at dtn.registerTool time)
  │       lets a conversation-type owner attach a DTN namespace to their type
  │
  └── getTools(conversationType)
          unchanged: filters tools[] by availableFor — DTN tools appear/disappear naturally
          as they're added/removed through the DTN object

Shutdown (alice-core.ts, mirrors cleanupWebSocketServers):
  │
  └── AlicePluginEngine.cleanupDynamicToolNamespaces()
          force-unregisters all DTN-owned tools, clears DTN state
```

### Component breakdown

| Component                        | File                                      | Responsibility                                                                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool registry (existing)         | `src/lib/tools.ts`                        | `addTool`, `getTools`, `hasTool`, `hasToolByCanonicalName`, `addConversationTypeToTool`, `getCanonicalToolName` — extended with `removeTool` and `removeConversationTypeFromTool`                                                        |
| Tool type (existing)             | `src/lib/tool-system.ts`                  | `Tool` type — extended with optional `dtnOwnerId?: string` for tracking ownership                                                                                                                                                        |
| Plugin engine (existing)         | `src/lib/alice-plugin-engine.ts`          | `registerTool` (unchanged behavior), new `declareDTN` method on the plugin API, new `addToolNamespaceToConversationType` method on the plugin API, mutual-exclusivity guards, canonical-name registry, link resolution, shutdown cleanup |
| Plugin interface type (existing) | `src/lib/types/alice-plugin-interface.ts` | New `declareDTN` and `addToolNamespaceToConversationType` signatures, new `DynamicToolNamespace` type exported from `lib.ts`                                                                                                             |
| Public surface (existing)        | `src/lib.ts`                              | Re-export `DynamicToolNamespace` type                                                                                                                                                                                                    |
| Tool executor (existing)         | `src/lib/conversation/tool-executor.ts`   | Unchanged — already returns "not recognized" for missing tools, which is exactly the graceful handling the notebook's "snag #2" calls for                                                                                                |

### Data models

**`DynamicToolNamespace` (new type, returned by `declareDTN`):**

```typescript
export type DynamicToolNamespace = {
  /**
   * Register a tool under this DTN. Callable at any time after registration
   * closes (not gated by assertRegistrationOpen). The tool's `availableFor`
   * is overwritten with the DTN's declared conversation-type set.
   *
   * @returns The canonical tool name (e.g. "mcp_client.some_tool"), which is
   *          the handle accepted by unregisterTool.
   * @throws If the canonical name collides with an existing static or DTN tool.
   */
  registerTool: (tool: Tool) => string;

  /**
   * Remove a tool previously registered via this DTN's registerTool.
   * No-op if the canonical name is not currently registered (robust against
   * removal-then-call races where a tool was already unregistered by the time
   * this is called).
   */
  unregisterTool: (canonicalName: string) => void;
};
```

**`DeclareDTNOptions` (argument to `declareDTN`):**

```typescript
export type DeclareDTNOptions = {
  /** Conversation types every tool registered through this DTN will be available for. */
  availableFor: ConversationTypeId[];
};
```

**Engine-internal state (added to `alice-plugin-engine.ts`):**

```typescript
// Tracks plugins that have declared a DTN — used for mutual-exclusivity enforcement.
const declaredDtnPluginIds = new Set<string>();

// Maps canonical tool name -> owning plugin id, for DTN-owned tools only.
// (Static tools continue to use registeredCanonicalToolNames; this is parallel
// to keep the "which tools belong to which DTN for cleanup" lookup fast.)
const dtnOwnedToolNames = new Map<string, string>();

// Pending namespace-to-conversation-type links, resolved at init() time AND
// re-checked at dtn.registerTool time so newly-registered DTN tools pick up
// existing links without requiring the linking plugin to re-call.
const pendingToolNamespaceLinks: Array<{
  requestingPluginId: string;
  conversationTypeId: string;
  sourcePluginId: string; // must be a DTN owner
}> = [];
```

### API contracts

**`plugin.declareDTN(options: DeclareDTNOptions): DynamicToolNamespace`**

Called during the registration callback (enforced by `assertRegistrationOpen('DTN')`). Throws if:

- The plugin has already registered any static tool via `plugin.registerTool()` (R3)
- The plugin has already declared a DTN (R5)

**`plugin.addToolNamespaceToConversationType(conversationTypeId, sourcePluginId: string): void`**

Called during registration (gated by `assertRegistrationOpen`). Records a pending link. Throws at `init()` resolution time if:

- The requesting plugin does not own the conversation type (mirrors existing `addToolToConversationType` check)
- The source plugin is enabled and is not a DTN owner
- Requesting a plugin that is not enabled should not throw. It simply doesn't bring the requested tools over. This allows plugins to have effectively "optional" dependencies, and is used with static tools already.

At runtime, when a DTN registers a tool whose owning plugin has a pending link to a conversation type, the tool is added to that conversation type's available set. When a DTN unregisters a tool, it is removed from all conversation-type associations.

**Mutual-exclusivity invariant enforcement:**

- On `plugin.registerTool(staticTool)`: if `declaredDtnPluginIds.has(pluginMetadata.id)`, throw with message naming the plugin and explaining it has already declared a DTN.
- On `plugin.declareDTN(...)`: if `registeredToolOwners` has any tool owned by this plugin (i.e. it has registered a static tool), or if `declaredDtnPluginIds.has(pluginMetadata.id)`, throw.

### Interaction with existing systems

**Taint / secure-tool semantics (R8):** DTN-registered tools carry the same `taintStatus?: 'tainted' | 'clean' | 'secure'` field as static tools. It is the plugin's responsibility to set it appropriately (the plugin decides how to map an MCP server's tool to a taint level — that mapping question is deferred to the `mcp-client` plan per Notebook Q3). The existing filter in `buildLlmToolDefinitions` (drops `secure` tools when conversation is tainted) and the taint-tracking in `tool-executor.ts` (adds to `taintedToolNamesAdded` when a `tainted` tool runs) apply unchanged to DTN tools because they operate on `Tool` objects in the same `tools[]` array.

**Tool-call event dispatch (R8):** `executeSingleTool` in `tool-executor.ts` already dispatches `tool_call_started`/`completed`/`error` events based on the `Tool` object it finds by name. DTN tools are found by the same `tools.find(t => t.name === toolName || t.canonicalName === toolName)` lookup (line 143), so events flow unchanged.

**Tool-call timing races (R14, Notebook snag #2):** If the LLM emits a tool call for a tool that a DTN unregistered between the request being built and the call being executed, the existing `tool-executor.ts` line 146–153 path returns `{ role: 'tool', content: 'Tool ${toolName} is not recognized.', ... }` back to the LLM. On the next retry/turn, `buildLlmToolDefinitions` will not list the removed tool, so the LLM should not re-attempt it. This matches the notebook's proposed "cleanest option" verbatim — no new logic required, just verified to hold.

## New Package Dependencies

None. DTNs are implemented entirely with existing language features and the existing tool registry. No new npm packages are introduced.

## Project Structure

All changes are in existing files under `src/lib/` (the engine owns this capability — it is not itself a plugin). No new plugin directories are created. This is consistent with the project convention that core tooling machinery lives in `src/lib/tools.ts`, `src/lib/tool-system.ts`, and `src/lib/alice-plugin-engine.ts`, and that plugin-facing types are declared in `src/lib/types/alice-plugin-interface.ts` and re-exported through `src/lib.ts`.

### Files touched

| File                                      | Action | Description                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/tools.ts`                        | Modify | Add `removeTool(canonicalName)` and `removeConversationTypeFromTool` helpers; these are the inverse of `addTool`/`addConversationTypeToTool` and are needed for DTN unregister + cleanup                                                                         |
| `src/lib/tool-system.ts`                  | Modify | Add optional `dtnOwnerId?: string` to `Tool` type (engine-internal field, not set by plugins)                                                                                                                                                                    |
| `src/lib/alice-plugin-engine.ts`          | Modify | Add `declareDTN` and `addToolNamespaceToConversationType` to the plugin API; add mutual-exclusivity guards; add DTN state maps; resolve `pendingToolNamespaceLinks` at `init()` and at DTN register/unregister time; add `cleanupDynamicToolNamespaces()` method |
| `src/lib/types/alice-plugin-interface.ts` | Modify | Add `declareDTN` and `addToolNamespaceToConversationType` signatures; add `DynamicToolNamespace` and `DeclareDTNOptions` types (exported via `lib.ts`)                                                                                                           |
| `src/lib.ts`                              | Modify | Re-export `DynamicToolNamespace` and `DeclareDTNOptions`                                                                                                                                                                                                         |
| `src/lib/alice-core.ts`                   | Modify | Call `AlicePluginEngine.cleanupDynamicToolNamespaces()` after `cleanupWebSocketServers()` in both the SIGINT/SIGTERM shutdown path (line 34) and the smoke-test shutdown path (line 87)                                                                          |
| `src/lib/tools.test.ts`                   | Modify | Add tests for `removeTool` and `removeConversationTypeFromTool`                                                                                                                                                                                                  |
| `src/lib/alice-plugin-engine.test.ts`     | Create | New co-located test file for DTN behavior (mutual exclusivity, register/unregister, link resolution, cleanup) — see Testing Strategy                                                                                                                             |

## Implementation Steps

### Step 1: Add inverse helpers to `tools.ts`

**File:** `src/lib/tools.ts`
**Complexity:** Low
**Dependencies:** None

Add two helpers mirroring the existing `addTool` / `addConversationTypeToTool`:

```typescript
/**
 * Remove a tool by canonical name. Used by DTN unregister and engine cleanup.
 * No-op if the canonical name is not currently registered.
 */
export function removeTool(canonicalName: string): void {
  const index = tools.findIndex(tool => tool.canonicalName === canonicalName);
  if (index === -1) {
    return;
  }
  tools.splice(index, 1);
}

/**
 * Remove a conversation type association from a tool. Used by DTN unregister
 * to undo associations applied via the namespace-link mechanism. No-op if the
 * tool does not currently have the association.
 */
export function removeConversationTypeFromTool(
  canonicalName: string,
  conversationType: DynamicPromptConversationType
): void {
  const tool = tools.find(t => t.canonicalName === canonicalName);
  if (!tool) {
    return;
  }
  tool.availableFor = tool.availableFor.filter(
    type => type !== conversationType
  );
}
```

Add unit tests in `src/lib/tools.test.ts` covering: no-op on unknown name, removes a known tool, removes a conversation-type association, idempotent on repeated calls.

### Step 2: Extend the `Tool` type

**File:** `src/lib/tool-system.ts`
**Complexity:** Low
**Dependencies:** None

Add an optional engine-internal field:

```typescript
export type Tool = {
  // ... existing fields unchanged ...
  /**
   * Engine-internal: set when the tool is registered via a DTN. Used by the
   * engine to distinguish DTN-owned tools from static tools during cleanup
   * and mutual-exclusivity checks. Plugins should never set this directly.
   */
  dtnOwnerId?: string;
};
```

### Step 3: Add DTN state and helpers to `alice-plugin-engine.ts`

**File:** `src/lib/alice-plugin-engine.ts`
**Complexity:** Medium
**Dependencies:** Steps 1, 2

At the top of the file, alongside the existing `registeredCanonicalToolNames` / `registeredToolOwners` / `registeredWebSocketServers` declarations (around line 40–57), add:

```typescript
/** Plugin IDs that have declared a DTN — for mutual-exclusivity enforcement. */
const declaredDtnPluginIds = new Set<string>();

/** Canonical tool name -> owning plugin id, for DTN-owned tools only. */
const dtnOwnedToolNames = new Map<string, string>();

/** Pending namespace-to-conversation-type links. */
const pendingToolNamespaceLinks: Array<{
  requestingPluginId: string;
  conversationTypeId: string;
  sourcePluginId: string;
}> = [];

/** Live namespace links, after init() resolution. Each entry means:
 *  "every tool registered under sourcePluginId's DTN should also be available
 *   for conversationTypeId, in addition to the DTN's own declared availableFor." */
const activeToolNamespaceLinks = new Map<string, Set<string>>();
// key: sourcePluginId (DTN owner)  value: set of conversationTypeId to also attach
```

Update `registerTool` (currently lines 130–161) to check the mutual-exclusivity invariant at the top:

```typescript
registerTool: (toolDefinition: Tool) => {
  assertRegistrationOpen(`tool ${toolDefinition.name}`);

  if (declaredDtnPluginIds.has(pluginMetadata.id)) {
    throw new Error(
      `Plugin ${pluginMetadata.id} attempted to register a static tool ` +
        `(${toolDefinition.name}) after declaring a Dynamic Tool Namespace. ` +
        `A plugin may register static tools OR declare a DTN, but not both. ` +
        `Disable ${pluginMetadata.id} to fix your assistant. If you are developing ` +
        `this plugin, move all of its tools into the DTN, or remove the declareDTN call.`
    );
  }
  // ... rest of existing registerTool body unchanged ...
},
```

Add the new `declareDTN` method to the plugin API object (alongside `registerTool`, `registerHeaderSystemPrompt`, etc.):

```typescript
declareDTN: (options: DeclareDTNOptions): DynamicToolNamespace => {
  assertRegistrationOpen('Dynamic Tool Namespace');

  if (declaredDtnPluginIds.has(pluginMetadata.id)) {
    throw new Error(
      `Plugin ${pluginMetadata.id} attempted to declare a Dynamic Tool Namespace ` +
        `more than once. A plugin may only declare a single DTN. Disable ` +
        `${pluginMetadata.id} to fix your assistant. If you are developing this plugin, ` +
        `consolidate your tool registration into one declareDTN call.`
    );
  }

  // Reject if this plugin has already registered any static tool.
  const owners = registeredToolOwners;
  let hasStatic = false;
  for (const ownerSet of owners.values()) {
    if (ownerSet.has(pluginMetadata.id)) {
      hasStatic = true;
      break;
    }
  }
  if (hasStatic) {
    throw new Error(
      `Plugin ${pluginMetadata.id} attempted to declare a Dynamic Tool Namespace ` +
        `after registering static tools. A plugin may register static tools OR ` +
        `declare a DTN, but not both. Disable ${pluginMetadata.id} to fix your ` +
        `assistant. If you are developing this plugin, remove the registerTool calls ` +
        `or remove the declareDTN call.`
    );
  }

  // Validate conversation types up-front (mirrors addTool's check) so a bad
  // DTN declaration fails fast at registration time rather than at the first
  // registerTool call later.
  for (const conversationType of options.availableFor) {
    if (!hasConversationType(conversationType)) {
      throw new Error(
        `Plugin ${pluginMetadata.id} attempted to declare a DTN with unknown ` +
          `conversation type ${conversationType}. Register that conversation type ` +
          `before declaring the DTN. Known conversation types are: ` +
          `${listConversationTypes().map(t => t.id).join(', ')}.`
      );
    }
  }

  declaredDtnPluginIds.add(pluginMetadata.id);

  const dtn: DynamicToolNamespace = {
    registerTool: (tool: Tool) => {
      // NOT gated by assertRegistrationOpen — DTN tools appear/disappear at runtime.

      // Stamp canonical name using the same scheme as static tools.
      const canonicalName = getCanonicalToolName(
        pluginMetadata.id,
        tool.name
      );

      if (registeredCanonicalToolNames[canonicalName]) {
        throw new Error(
          `Plugin ${pluginMetadata.id} attempted to register a DTN tool with ` +
            `canonical name "${canonicalName}", but that canonical name is already ` +
            `registered by plugin ${registeredCanonicalToolNames[canonicalName]}. ` +
            `Disable one of these plugins to fix your assistant, or change the tool name.`
        );
      }

      // Overwrite availableFor with the DTN's declared set, then apply any
      // active namespace links (conversation types other plugins have attached
      // to this DTN's namespace).
      const availableFor = new Set<ConversationTypeId>(options.availableFor);
      const links = activeToolNamespaceLinks.get(pluginMetadata.id);
      if (links) {
        for (const extraType of links) {
          availableFor.add(extraType);
        }
      }
      tool.availableFor = [...availableFor];
      tool.canonicalName = canonicalName;
      tool.dtnOwnerId = pluginMetadata.id;

      // Track local name ownership (consistent with static path) for any future
      // tool-link resolution that consults registeredToolOwners.
      const localOwners =
        registeredToolOwners.get(tool.name) ?? new Set();
      localOwners.add(pluginMetadata.id);
      registeredToolOwners.set(tool.name, localOwners);

      registeredCanonicalToolNames[canonicalName] = pluginMetadata.id;
      dtnOwnedToolNames.set(canonicalName, pluginMetadata.id);
      addTool(tool);

      return canonicalName;
    },

    unregisterTool: (canonicalName: string) => {
      // Only remove tools this DTN owns — robust against a plugin trying to
      // unregister a name it never registered (or already unregistered).
      if (dtnOwnedToolNames.get(canonicalName) !== pluginMetadata.id) {
        return;
      }
      removeTool(canonicalName);
      dtnOwnedToolNames.delete(canonicalName);
      delete registeredCanonicalToolNames[canonicalName];
      // Note: we intentionally do NOT clean up registeredToolOwners here, since
      // that set is append-only across a plugin's lifetime and removing a single
      // entry would be racy if the plugin re-registers the same local name.
    },
  };

  return dtn;
},
```

Add the new `addToolNamespaceToConversationType` method:

```typescript
addToolNamespaceToConversationType: (
  conversationTypeId: ConversationTypeId,
  sourcePluginId: string
) => {
  assertRegistrationOpen(
    `tool namespace link ${sourcePluginId} -> ${conversationTypeId}`
  );
  pendingToolNamespaceLinks.push({
    requestingPluginId: pluginMetadata.id,
    conversationTypeId,
    sourcePluginId,
  });
},
```

### Step 4: Resolve namespace links at `init()` and at DTN register/unregister time

**File:** `src/lib/alice-plugin-engine.ts`
**Complexity:** Medium
**Dependencies:** Step 3

After the existing `pendingConversationTypeToolLinks.forEach(...)` block (currently lines 524–549), add a parallel block that resolves namespace links:

```typescript
pendingToolNamespaceLinks.forEach(link => {
  const conversationTypeOwner = getConversationTypeOwner(
    link.conversationTypeId
  );
  if (conversationTypeOwner !== link.requestingPluginId) {
    throw new Error(
      `Plugin ${link.requestingPluginId} attempted to link the DTN namespace of ` +
        `${link.sourcePluginId} to conversation type ${link.conversationTypeId}, ` +
        `but that conversation type is not owned by ${link.requestingPluginId}. ` +
        `Register the conversation type first in ${link.requestingPluginId}, then retry.`
    );
  }

  const sourcePluginEnabled = !!registeredPlugins[link.sourcePluginId];
  if (!sourcePluginEnabled) {
    return; // source plugin disabled — silently skip, matches existing tool-link behavior
  }

  if (!declaredDtnPluginIds.has(link.sourcePluginId)) {
    throw new Error(
      `Plugin ${link.requestingPluginId} attempted to link the DTN namespace of ` +
        `${link.sourcePluginId} to conversation type ${link.conversationTypeId}, but ` +
        `${link.sourcePluginId} is enabled and is not a DTN owner. Disable ` +
        `${link.requestingPluginId} to fix your assistant, or correct the requested ` +
        `plugin id if you are developing this plugin.`
    );
  }

  // Record the active link so future dtn.registerTool calls add this
  // conversation type to the tool's availableFor.
  const linkSet =
    activeToolNamespaceLinks.get(link.sourcePluginId) ?? new Set();
  linkSet.add(link.conversationTypeId);
  activeToolNamespaceLinks.set(link.sourcePluginId, linkSet);

  // Apply the link to any tools the source DTN has already registered.
  // (init() runs after all registration callbacks, so a DTN owner may have
  // already registered tools during onAllPluginsLoaded, which fires before
  // this link-resolution block runs in init()... actually, no — onAllPluginsLoaded
  // is invoked AFTER the pending-link resolution below. So at init() time, a
  // DTN has not yet had a chance to register any tools, and this loop applies
  // to zero tools. But the loop is still correct and forward-compatible: if the
  // ordering ever changes, or a DTN registers synchronously inside its own
  // registration callback (legal, since registerTool is not gated), this loop
  // picks them up.)
  for (const [canonicalName, ownerId] of dtnOwnedToolNames) {
    if (ownerId === link.sourcePluginId) {
      addConversationTypeToTool(canonicalName, link.conversationTypeId);
    }
  }
});
```

Then patch `dtn.registerTool` (from Step 3) so that when a tool is registered, it consults `activeToolNamespaceLinks` for the owning plugin and folds in any linked conversation types — this is already shown in the Step 3 snippet above (the `links` block).

And patch `dtn.unregisterTool` so that it also strips the tool from any linked conversation types. Since `removeTool` already removes the tool entirely from `tools[]`, the conversation-type associations are discarded with it — no extra call is needed. (`removeConversationTypeFromTool` from Step 1 is kept available for future fine-grained use, but DTN full-unregister is simpler as a wholesale removal.)

### Step 5: Add shutdown cleanup

**File:** `src/lib/alice-plugin-engine.ts` and `src/lib/alice-core.ts`
**Complexity:** Low
**Dependencies:** Steps 1, 3

Add to `AlicePluginEngine` (alongside `cleanupWebSocketServers`, currently lines 563–578):

```typescript
/**
 * Force-unregister all DTN-owned tools and clear DTN state. Called during
 * shutdown to ensure clean teardown even if a plugin forgets to clean up.
 * Mirrors cleanupWebSocketServers().
 */
cleanupDynamicToolNamespaces: () => {
  for (const canonicalName of dtnOwnedToolNames.keys()) {
    removeTool(canonicalName);
  }
  dtnOwnedToolNames.clear();
  declaredDtnPluginIds.clear();
  activeToolNamespaceLinks.clear();
  pendingToolNamespaceLinks.length = 0;
},
```

In `src/lib/alice-core.ts`, add the call immediately after each `AlicePluginEngine.cleanupWebSocketServers()` call (lines 34 and 87):

```typescript
AlicePluginEngine.cleanupWebSocketServers();
AlicePluginEngine.cleanupDynamicToolNamespaces();
```

(Both the SIGINT/SIGTERM path and the `ALICE_SMOKE_TEST` path.)

### Step 6: Update the public type surface

**File:** `src/lib/types/alice-plugin-interface.ts`
**Complexity:** Low
**Dependencies:** Steps 2, 3

Import `ConversationTypeId` (already imported), `Tool` (already imported). Add the two new types and extend `AlicePluginInterface['registerPlugin']`'s return type:

```typescript
export type DeclareDTNOptions = {
  availableFor: ConversationTypeId[];
};

export type DynamicToolNamespace = {
  registerTool: (tool: Tool) => string;
  unregisterTool: (canonicalName: string) => void;
};
```

Add to the return type of `registerPlugin: () => Promise<{ ... }>` (alongside `registerTool`, `registerWebSocket`, etc.):

```typescript
declareDTN: (options: DeclareDTNOptions) => DynamicToolNamespace;
addToolNamespaceToConversationType: (
  conversationTypeId: ConversationTypeId,
  sourcePluginId: string
) => void;
```

### Step 7: Re-export from `lib.ts`

**File:** `src/lib.ts`
**Complexity:** Trivial
**Dependencies:** Step 6

```typescript
export type {
  DynamicToolNamespace,
  DeclareDTNOptions,
} from './lib/types/alice-plugin-interface.js';
```

### Step 8: Write the test suite

**File:** `src/lib/alice-plugin-engine.test.ts` (new)
**Complexity:** Medium
**Dependencies:** Steps 1–7

Co-located test file covering the DTN contract. Use the existing `vi.resetModules()` + dynamic-import pattern from `src/lib/tools.test.ts` to reset module-level state between tests. Cover:

1. **Mutual exclusivity — static-first then DTN:** register a static tool, then call `declareDTN` → throws with plugin id in the message.
2. **Mutual exclusivity — DTN-first then static:** call `declareDTN`, then call `registerTool` → throws with plugin id and tool name in the message.
3. **Double-declare:** call `declareDTN` twice → throws.
4. **`declareDTN` after registration closed:** call `declareDTN` from outside the registration callback (simulate by closing registration then invoking) → throws via `assertRegistrationOpen`.
5. **DTN `registerTool` after registration closed:** call `declareDTN` during registration, then later (after `closeRegistration`) call `dtn.registerTool` → succeeds (this is the whole point of DTNs).
6. **Canonical name collision:** register a static tool `foo` under plugin `p1`, then a DTN under plugin `p2` registers `foo` → throws (canonical names collide).
7. **`unregisterTool` happy path:** register a DTN tool, verify it appears in `getTools(conversationType)`, unregister it, verify it disappears.
8. **`unregisterTool` no-op on unknown name:** call `unregisterTool('mcp_client.never_registered')` → no throw, no side effect.
9. **`availableFor` inheritance:** declare a DTN with `availableFor: ['chat']`, register a tool whose `availableFor` is `['voice']`, verify the tool is offered for `'chat'` (DTN's declared set wins) and not for `'voice'`.
10. **Namespace link applies at register time:** plugin A owns conversation type `custom-type` and calls `addToolNamespaceToConversationType('custom-type', 'p-dtn')`; plugin `p-dtn` declares a DTN with `availableFor: ['chat']`; after init, `p-dtn` registers a tool via the DTN; verify the tool is offered for both `'chat'` and `'custom-type'`.
11. **Namespace link rejected when source is not a DTN owner:** link to a plugin that registered only static tools → throws at init() time.
12. **Namespace link rejected when requester doesn't own the conversation type** → throws at init() time.
13. **Cleanup:** register DTN tools, call `AlicePluginEngine.cleanupDynamicToolNamespaces()`, verify `getTools` no longer returns any of them and `hasToolByCanonicalName` returns false.
14. **Taint semantics carry through:** register a DTN tool with `taintStatus: 'tainted'`, run it via `executeTools` (mock the execute fn), verify it lands in `taintedToolNamesAdded`. Register a DTN tool with `taintStatus: 'secure'`, verify it is filtered out of `buildLlmToolDefinitions` when `isConversationTainted = true`.
15. **Removed-tool race:** register a DTN tool, build an LLM tool-definition list (so the LLM "sees" it), unregister it, then call `executeTools` with a tool call referencing the now-removed canonical name → verify the result message is `Tool <name> is not recognized.` (this is the notebook's snag #2 graceful path).

### Step 9: Lint, test, build, smoke test

**Complexity:** Low
**Dependencies:** Step 8

```bash
npm run lint
npm test
npm run build
```

Then a smoke test against a temporary config dir that enables a tiny throwaway DTN-owning test plugin (no need to ship it — add it to `src/plugins/community/test-agents/` style, or use a user-plugin dir under `ALICE_CONFIG_DIR`):

```bash
ALICE_CONFIG_DIR=/tmp/alice-dtn-smoke ALICE_SMOKE_TEST=1 npm start
```

Per `AGENTS.md`, first verify with `ollama list` that the fallback model in the temp `alice.json` is pulled locally (default scaffold uses `qwen2:7b`). The smoke test exercises the full load → register → declareDTN → onAllPluginsLoaded (where the DTN registers a tool) → onAssistantAcceptsRequests → shutdown → `cleanupDynamicToolNamespaces` sequence.

## File Changes Summary

| File                                      | Action | Description                                                                                                                                   |
| ----------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/tools.ts`                        | Modify | Add `removeTool` and `removeConversationTypeFromTool` helpers                                                                                 |
| `src/lib/tool-system.ts`                  | Modify | Add optional `dtnOwnerId?: string` to `Tool` type                                                                                             |
| `src/lib/alice-plugin-engine.ts`          | Modify | Add `declareDTN`, `addToolNamespaceToConversationType`, mutual-exclusivity guards, DTN state, link resolution, `cleanupDynamicToolNamespaces` |
| `src/lib/types/alice-plugin-interface.ts` | Modify | Add `declareDTN`/`addToolNamespaceToConversationType` signatures; add `DynamicToolNamespace` and `DeclareDTNOptions` types                    |
| `src/lib.ts`                              | Modify | Re-export `DynamicToolNamespace` and `DeclareDTNOptions`                                                                                      |
| `src/lib/alice-core.ts`                   | Modify | Call `cleanupDynamicToolNamespaces()` in both shutdown paths                                                                                  |
| `src/lib/tools.test.ts`                   | Modify | Add tests for `removeTool` and `removeConversationTypeFromTool`                                                                               |
| `src/lib/alice-plugin-engine.test.ts`     | Create | New DTN test suite (15 cases, see Step 8)                                                                                                     |

## Testing Strategy

### Unit tests

- `src/lib/tools.test.ts` — extended with `removeTool` / `removeConversationTypeFromTool` cases (no-op on unknown, removal, idempotence).
- `src/lib/alice-plugin-engine.test.ts` — new file, 15 cases listed in Step 8. Uses `vi.resetModules()` per test to reset engine module state, mirroring the pattern in `tools.test.ts`. Mocks external dependencies (`rest-serve`, `UserConfig`) only where the engine code path being tested reaches them; most DTN cases never touch those.

### Integration tests

- No new integration test file. The existing `src/lib/conversation.test.ts` and `src/lib/conversation-max-tool-depth.test.ts` exercise the conversation/tool-execution path against static tools and must continue to pass unchanged (regression guard for R17). The DTN path is covered by the unit suite's cases 7, 8, 10, 13, 14, 15 which exercise the same downstream machinery (`getTools`, `buildLlmToolDefinitions`, `executeTools`) that the integration tests cover.

### Manual / smoke testing

1. `npm run lint && npm test && npm run build` — all green.
2. Create `/tmp/alice-dtn-smoke` config dir, enable a throwaway DTN-owning plugin that registers a tool in `onAllPluginsLoaded`, run with `ALICE_SMOKE_TEST=1` and a locally-pulled fallback model. Verify:
   - Startup completes without errors.
   - Log shows the DTN tool being registered post-registration-callback.
   - Clean shutdown runs `cleanupDynamicToolNamespaces` (verify via a log line added to the cleanup method).
3. With the assistant running normally (not smoke test), start a chat, invoke the DTN-registered tool from a user message, verify the tool executes and its result returns to the LLM.

## Definition of Done

- [ ] `plugin.declareDTN(options)` returns a `DynamicToolNamespace` with `registerTool`/`unregisterTool`
- [ ] Mutual-exclusivity throws fire in both directions (static-then-DTN and DTN-then-static) and name the offending plugin
- [ ] Double-declare throws with an actionable message
- [ ] `declareDTN` is gated by `assertRegistrationOpen`; `dtn.registerTool`/`dtn.unregisterTool` are NOT gated and work after `closeRegistration()`
- [ ] A tool registered via a DTN appears in `getTools(conversationType)` for the DTN's declared conversation types
- [ ] A tool registered via a DTN disappears from `getTools` after `unregisterTool(canonicalName)`
- [ ] `unregisterTool` on an unknown canonical name is a no-op (no throw)
- [ ] Canonical-name uniqueness is enforced across static and DTN tools (collision throws)
- [ ] `availableFor` on a DTN-registered tool equals the DTN's declared set (the tool's own `availableFor` is overwritten)
- [ ] `addToolNamespaceToConversationType` causes DTN tools to appear for the linked conversation type, including tools registered after the link is established
- [ ] `addToolNamespaceToConversationType` throws at init() when the source plugin is not a DTN owner or the requester doesn't own the conversation type
- [ ] DTN-registered tools respect `taintStatus` (`tainted` adds to `taintedToolNames`; `secure` is filtered when conversation is tainted) — verified by unit test case 14
- [ ] A tool call for a DTN-unregistered tool returns `Tool <name> is not recognized.` to the LLM (verified by unit test case 15)
- [ ] `AlicePluginEngine.cleanupDynamicToolNamespaces()` removes all DTN-owned tools and clears DTN state; called in both shutdown paths in `alice-core.ts`
- [ ] `npm run lint` passes
- [ ] `npm test` passes with the new test file included and zero regressions in existing tests
- [ ] `npm run build` succeeds
- [ ] `ALICE_SMOKE_TEST=1` run against a temp config with a DTN-owning plugin completes startup and clean shutdown with no errors
- [ ] `DynamicToolNamespace` and `DeclareDTNOptions` are exported from `src/lib.ts`
- [ ] All new error messages name the offending plugin and describe the recovery step (disable the plugin / change the name), per the project's error-handling convention

## Risks & Mitigations

| Risk                                                                                                                                   | Impact                                                                             | Mitigation                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A plugin calls `dtn.registerTool` for a canonical name that another plugin's static tool already owns (cross-plugin collision)         | LLM tool list could contain duplicates or one tool silently shadows another        | `dtn.registerTool` checks `registeredCanonicalToolNames` and throws immediately (R12). Same registry static `registerTool` uses — no new collision surface.                                                                                                                                                                        |
| Race: LLM emits a tool call for a DTN tool that was unregistered between request-build and execution                                   | One wasted LLM turn, possible confusing log noise                                  | Already handled: `tool-executor.ts` returns `"Tool <name> is not recognized."` (R14). The next retry's `buildLlmToolDefinitions` won't list the tool, so the LLM won't re-attempt. Monitor for repeated retries on the same removed tool — if observed, the notebook flags a different solution may be needed (out of scope here). |
| A plugin forgets to call `unregisterTool` on its DTN tools before the process exits                                                    | Stale entries in `tools[]` that never get cleaned up                               | `cleanupDynamicToolNamespaces()` force-removes all `dtnOwnedToolNames` at shutdown (R15), mirroring the existing `cleanupWebSocketServers` pattern.                                                                                                                                                                                |
| `getTools(conversationType)` is called concurrently with `dtn.registerTool`/`unregisterTool` mutating `tools[]`                        | Array mutation during iteration could cause a skipped tool or a throw              | Node is single-threaded; `tools[]` mutations are synchronous and `getTools` uses `.filter` which snapshots. No mutex needed. Documented assumption; revisit only if DTN registration is ever done from an async hot path that interleaves with LLM request building.                                                               |
| Mutual-exclusivity check misses a plugin that registered a static tool before the DTN feature existed                                  | Plugin incorrectly allowed to do both                                              | Check is based on `registeredToolOwners` which is populated by the existing `registerTool` path — no migration needed; any plugin that has ever called `registerTool` is visible to the new check.                                                                                                                                 |
| A plugin that owns a conversation type calls `addToolNamespaceToConversationType` for a DTN that hasn't declared itself yet (ordering) | Link recorded but never resolves                                                   | Link is resolved at `init()` after ALL registration callbacks have run, so declaration order within registration doesn't matter. If the source plugin is disabled, the link is silently skipped (matches existing `addToolToConversationType` behavior).                                                                           |
| `dtnOwnerId` field on `Tool` is set by a misbehaving plugin to bypass cleanup                                                          | Stale tool not cleaned up                                                          | Field is documented engine-internal; cleanup uses `dtnOwnedToolNames` (engine-owned map) as source of truth, not the `Tool.dtnOwnerId` field, so a plugin spoofing the field has no effect on cleanup.                                                                                                                             |
| Existing tests rely on `tools[]` state persisting across test modules in unexpected ways                                               | New `removeTool`/`removeConversationTypeFromTool` could alter cleanup expectations | All existing engine/tools tests already use `vi.resetModules()` per test which re-initializes module state; the new helpers don't add global side effects.                                                                                                                                                                         |

## Timeline Estimate

**~1.5 days**, assuming the codebase is in the state observed during planning:

- Step 1 (inverse helpers + tests): 0.25 day
- Steps 2, 6, 7 (type-surface changes): 0.25 day
- Steps 3, 4 (engine core: declareDTN, link resolution): 0.5 day
- Step 5 (shutdown cleanup): 0.1 day
- Step 8 (15-case test suite): 0.5 day
- Step 9 (lint, test, build, smoke): 0.1 day

**Assumptions:**

- The `tools.ts` / `tool-system.ts` / `alice-plugin-engine.ts` files are in the state observed during planning (no concurrent refactors).
- The smoke-test throwaway DTN plugin can be added to a temp `ALICE_CONFIG_DIR` user-plugins directory without modifying `system-plugins.json`.
- No new npm packages need vetting (none are introduced).
- Code review happens in one round; the mutual-exclusivity invariant and the "DTN's `availableFor` wins over the tool's" decision are the two spots most likely to draw review feedback, and both are explicitly called out in the plan as decided per the notebook Q&A.

**Out of plan:** the `mcp-client` community plugin itself, which is a separate follow-on plan that depends on this one landing. Estimated separately when that plan is written.
