## Plan: Plugin Platform Foundation

Refactor toward a full plugin platform in incremental phases that preserve existing behavior. Core contract types are already defined in src/lib/alice-plugin-system.ts; src/plugins/memory/memory.ts is the reference implementation draft; src/plugins/system-plugins.json is the authoritative system plugin registry.

**Current API surface (as of latest draft in alice-plugin-system.ts)**
- AlicePlugin shape: pluginMetadata (static, always readable even if disabled) + registerPlugin(interface) async.
- AlicePluginMetadata: name, version (semver; system plugins only may use "LATEST"), description, system?, required?, dependencies?[].
- system-plugins.json: authoritative list of system plugin ids; only listed plugins may set system:true/required:true.
- Plugin handle (from registerPlugin): registerTool, registerHeaderSystemPrompt, registerFooterSystemPrompt, hooks{onUserConversationWillBegin, onUserConversationWillEnd, onAssistantStartup}, config<T>(schema).
- config() returns: getPluginConfig, updatePluginConfig, getSystemConfig (any — temporary until typed).
- Prompt weight constraint: non-system plugins restricted to positive header weights; footer weights capped at 9999 unless system plugin.
- Hook surface and plugin load order: explicitly TBD.

**Steps**

Phase 1: Harden the existing contract surface (current focus — primarily alice-plugin-system.ts)
1. Replace getSystemConfig(): any with a real typed SystemConfig shape derived from src/lib/user-config.ts. Block on this — no plugin should call getSystemConfig() with any types in production code.
2. Lock down config() contract: schema mismatch throws at load time (not runtime) with plugin id + field path + fix hint; define unknown-fields policy; apply defaults deterministically.
3. Design and add the offer/request capability-sharing API to the plugin handle. Typed capability keys namespaced by plugin id, availability guaranteed after registerPlugin resolves, lifetime/disposal behavior defined, clear failure when capability is absent.
4. Enforce system-plugins.json as the single gatekeeper for system:true/required:true — loader rejects any plugin claiming system privilege not in the list, with a clear error.
5. Nail down version-matching semantics for LATEST and semver ranges in dependencies[].

Phase 2: Plugin load order (resolved — unblocked)
6. Load order is declaration order: system plugins in system-plugins.json first, user plugins in ~/.alice-assistant/plugins.json second. The loader processes each list top-to-bottom in the order entries appear. No priority field, no topological sort.
7. Hooks are added on demand during Phase 4 migration — add a new hook to AlicePluginInterface only when a system plugin migration concretely requires it. Define execution ordering and error propagation rules per hook at the time it is introduced, not upfront.

Phase 3: Config layering and filesystem plugin loading (depends on Phase 1)
8. Extend src/lib/user-config.ts to discover plugins from a configured directory; existing alice.json and tool-settings formats stay untouched.
9. Built-in plugins (from system-plugins.json) load first; filesystem plugins second; system plugin names are reserved and cannot be claimed by filesystem plugins.
10. Startup compatibility: if no plugin config in alice.json, behavior is identical to today.

Phase 4: Migrate existing tools and prompts to plugins (depends on Phases 2 and 3)
11. Convert each tool in src/tools/* to a built-in plugin following the memory.ts pattern, preserving tool names and existing config file locations.
12. Migrate header/footer dynamic prompts to registerHeaderSystemPrompt/registerFooterSystemPrompt calls, preserving existing weights.
13. Migrate mood state out of module-level getMood() in src/tools/set-mood.ts into a shared service exposed via the offer/request API so src/lib/system-prompts/footers/mood-footer.ts consumes it without a direct import.

Phase 5: Hardening (parallel with late Phase 4)
14. Startup fails fast with actionable diagnostics for: missing required dependency, system privilege rejected, schema mismatch, dependency cycle.
15. Emit a structured startup report: plugins loaded, tools registered, prompts registered, capabilities offered, any skipped/failed plugins.
16. Add feature flag to disable filesystem plugin loading and restore built-ins-only mode.

**Relevant files**
- src/lib/alice-plugin-system.ts — primary contract surface (all type definitions live here)
- src/plugins/system-plugins.json — authoritative system plugin registry
- src/plugins/memory/memory.ts — reference implementation draft
- src/lib/user-config.ts — source of SystemConfig shape to replace getSystemConfig(): any
- src/lib/conversation.ts — Conversation type used in hook signatures
- src/lib/dynamic-prompt.ts — DynamicPrompt/DynamicPromptConversationType used in prompt registration
- src/lib/tool-system.ts — Tool type used in registerTool
- src/tools/set-mood.ts — module-level mood state to migrate to offer/request
- src/lib/system-prompts/footers/mood-footer.ts — direct mood import to migrate
- src/lib/alice-core.ts — startup orchestration; home for plugin loader invocation
- src/tools/index.ts — to be replaced by plugin-based tool registration

**Verification**
1. Built-ins-only mode produces identical tool availability, tool-call behavior, and prompt ordering as before refactor.
2. Schema mismatch in plugin config throws at startup with plugin id + field + fix hint, not at runtime.
3. Plugin claiming system:true not listed in system-plugins.json is rejected with a clear error.
4. Required dependency absent/disabled halts startup with an explanation.
5. Startup report lists all registered tools, prompts, and capabilities after load phase.
6. Fallback flag disables filesystem plugins; built-ins-only behavior is unchanged.

**Decisions**
- Scope: full platform plugins (tools, prompts, interfaces).
- Loading model: built-in (system-plugins.json) plus optional filesystem plugins.
- Priority: zero behavior change for existing users/configs.
- Prompt weight constraints enforced by plugin privilege tier (system vs non-system).
- pluginMetadata must be readable even if plugin is disabled (no side effects at module level).
- LATEST version string reserved for system plugins only.
- Hooks are added on demand during system plugin migration — not designed upfront. Each new hook is defined with its ordering and error propagation rules at the time it is added.
- Excluded initially: NPM plugin marketplace, hot reload, remote trust/signing, personality format redesign.
- Load order: declaration order in system-plugins.json (system plugins), then declaration order in ~/.alice-assistant/plugins.json (user plugins). No priority field, no topological sort.
- Dependencies must always be declared in pluginMetadata.dependencies[], even when load order already guarantees availability. This future-proofs the contract for when required plugins may become optional.
