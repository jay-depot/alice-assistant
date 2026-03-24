## Plan: Plugin Platform Migration (Broker-First)

Adopt the new scaffold conventions already present under src/plugins by implementing the plugin runtime contracts first (typed config + typed capability offer/request + deterministic loading), then migrating broker plugins before dependent feature plugins. Hooks are added only when a migration step requires them.

**Current State (from scaffolds)**
- System plugin registry exists in src/plugins/system-plugins.json.
- All plugins expose static pluginMetadata + async registerPlugin() shape.
- memory plugin is the reference implementation with tool + config + hook + header prompt in src/plugins/memory/memory.ts.
- datetime plugin already contributes a footer prompt and is the second-most mature scaffold in src/plugins/datetime/datetime.ts.
- Broker family exists but is mostly skeleton: location-broker, news-broker, weather-broker, web-search-broker, reminders-broker.
- Many plugins now depend on brokers (notably appointments, daily-goals, reminder notification plugins), so broker runtime APIs are the migration critical path.

**Steps**
1. Phase 1: Runtime contract hardening (blocking)
2. Finalize AlicePlugin interface contract in src/lib/alice-plugin-system.ts:
3. Replace getSystemConfig(): any with a typed system config shape.
4. Keep config<TSchema>() validation strict at load time with actionable plugin-scoped errors.
5. Add typed capability exchange API to plugin handle (offer/request) for broker-provider patterns.
6. Enforce system plugin privilege gate via src/plugins/system-plugins.json.
7. Validate declared dependencies[] for every plugin even when declaration-order loading already satisfies availability.
8. Phase 2: Deterministic loading and ordering (resolved)
9. Load system plugins in declaration order from src/plugins/system-plugins.json.
10. Load user plugins in declaration order from ~/.alice-assistant/plugins.json (when present).
11. Fail fast on unknown plugin ids, missing required dependencies, and dependency cycles.
12. Phase 3: Broker-first migration (depends on Phase 1 and 2)
13. Implement broker capability contracts before feature plugins:
14. location-broker capability contract (single provider arbitration and registration).
15. reminders-broker capability contract (source/provider registration, notification channel registration).
16. weather-broker/news-broker/web-search-broker capability contracts (provider registration and dispatch model).
17. Add only the hooks required by these broker migrations (likely onAssistantStartup first; other hooks only when needed).
18. Phase 4: Provider and consumer plugin migration (depends on Phase 3)
19. Provider plugins next: static-location, reminders-notification-conversation, reminders-notification-libnotify.
20. Core feature plugins after providers: application, mood, scratch-files, user-files, system-info.
21. Composite plugins last: appointments and daily-goals, after memory + datetime + reminders-broker are fully functional.
22. Keep external tool identities and existing tool-setting file semantics unchanged during migration.
23. Phase 5: Prompt/state integration and hardening (parallel with late Phase 4)
24. Migrate mood shared state to capability API (replace direct module coupling with offer/request).
25. Keep prompt weights/ordering stable while moving prompts behind plugin registration.
26. Add startup diagnostics report: loaded plugins, dependency graph, offered capabilities, registered tools/prompts, failures/skips.
27. Add fallback flag to disable user plugin loading and run built-ins only.

**Relevant files**
- src/lib/alice-plugin-system.ts — canonical plugin runtime contracts (metadata/interface/hooks/config/capabilities)
- src/plugins/system-plugins.json — declaration-order system plugin load source
- src/plugins/memory/memory.ts — reference implementation for config/tool/hook/prompt usage
- src/plugins/datetime/datetime.ts — near-complete prompt plugin scaffold
- src/plugins/location-broker/location-broker.ts — provider arbitration broker pattern
- src/plugins/reminders-broker/reminders-broker.ts — multi-provider broker pattern
- src/plugins/news-broker/news-broker.ts — location/datetime-dependent broker
- src/plugins/weather-broker/weather-broker.ts — location/datetime-dependent broker
- src/plugins/web-search-broker/web-search-broker.ts — generic search broker boundary
- src/plugins/static-location/static-location.ts — location provider plugin
- src/plugins/reminders-notification-conversation/reminders-notification-conversation.ts — broker consumer/provider
- src/plugins/reminders-notification-libnotify/reminders-notification-libnotify.ts — broker consumer/provider
- src/plugins/appointments/appointments.ts — high-dependency composite plugin
- src/plugins/daily-goals/daily-goals.ts — high-dependency composite plugin
- src/lib/user-config.ts — typed system config source and future plugins.json handling
- src/lib/alice-core.ts — startup orchestration and plugin loader integration point

**Verification**
1. Built-ins-only boot path unchanged in behavior before/after migration.
2. Plugin metadata can be read without executing plugin side effects.
3. Dependency validation runs for every plugin and catches missing/disabled/cyclic deps.
4. System privilege assertions are rejected unless plugin id is present in system-plugins.json.
5. Broker capability registration/request works with deterministic startup order.
6. Provider plugins can register with brokers and be consumed by dependents without race conditions.
7. Prompts and tools preserve existing names/order/availability semantics.
8. User plugin list in ~/.alice-assistant/plugins.json is optional; absent file is non-fatal.

**Decisions**
- Hooks are implemented on demand during migration, not fully designed upfront.
- Load order is declaration order for both system and user plugin lists.
- Dependencies remain mandatory declarations for forward compatibility if required plugins later become optional.
- Broker plugins are first-class architecture boundaries and migrate before their dependents.
- Scope remains zero user-facing behavior regression during core migration.
