## Plan: Plugin Platform Migration (Status-Updated)

The plugin architecture has advanced from scaffolding to partial implementation. Core interfaces, identity fields, dependency shape, hook definitions, and several broker capability APIs now exist. The remaining work is mostly runtime enforcement and lifecycle integration.

**Completed**
1. Canonical contract file established in `src/lib/alice-plugin-interface.ts`.
2. Plugin identity model established: `pluginMetadata.id` (canonical) and `pluginMetadata.name` (display).
3. Dependency model updated to object form: `{ id, version | version[] }`.
4. Broad hook surface defined in `AlicePluginInterface` (conversation/tool/startup/shutdown hooks).
5. Capability exchange API added to interface (`offer` / `request`) with declaration-merging pattern for `PluginCapabilities`.
6. System plugin registry naming drift fixed (`schedule` removed from `src/plugins/system-plugins.json`).
7. Memory plugin metadata normalization completed (`name: 'Memory Plugin'` in `src/plugins/memory/memory.ts`).
8. Broker scaffolds now expose real offered capabilities in code:
9. `location-broker` offers location provider registration + request API and closes registration at `onAllPluginsLoaded`.
10. `news-broker`, `weather-broker`, and `reminders-broker` now offer initial broker APIs.

**In Progress**
1. Runtime semantics exist in interface/comments but are not yet enforced by a loader implementation:
2. `offer()` “once during registerPlugin only”.
3. `request()` restricted to declared dependencies.
4. Version resolution semantics including `LATEST`.
5. Hook ordering and fatal/non-fatal error policy execution.
6. Memory capability lifecycle is drafted but not operational:
7. `registerDatabaseModels()` and `onDatabaseReady()` exist in API shape but ORM lifecycle wiring is TODO.

**Not Started / Remaining**
1. Replace `getSystemConfig(): any` with typed system config return in `src/lib/alice-plugin-interface.ts`.
2. Add plugin loader/runtime that actually drives:
3. declaration-order loading from `src/plugins/system-plugins.json`.
4. optional user plugin loading from `~/.alice-assistant/plugins.json`.
5. dependency-cycle and missing-dependency fail-fast behavior.
6. startup/shutdown hook invocation order and enforcement.
7. Integrate plugin runtime into startup orchestration in `src/lib/alice-core.ts`.
8. Finalize memory-backed ORM lifecycle window:
9. collect model registrations from dependents.
10. initialize MikroORM once.
11. close registration window.
12. fire ready callbacks deterministically.
13. Migrate provider plugins to actually register with brokers:
14. `static-location` -> `location-broker`.
15. reminders notification providers -> `reminders-broker`.
16. Migrate feature/composite plugins (`application`, `mood`, `scratch-files`, `user-files`, `appointments`, `daily-goals`) from metadata-only to concrete tool/prompt/capability behavior.
17. Add diagnostics and rollback controls (built-ins-only mode, plugin load report, policy violation messages).

**Next Execution Steps**
1. Phase A: Runtime enforcement foundation (blocking)
2. Implement plugin runtime/loader module that enforces id/dependency/version/request/offer policies and executes hooks.
3. Wire loader into `AliceCore.start()` with declaration-order system plugin loading.
4. Add optional user plugin list loading from `~/.alice-assistant/plugins.json` (non-fatal if absent).

5. Phase B: Memory lifecycle completion
6. Complete memory broker capability behavior (`registerDatabaseModels`, `onDatabaseReady`) and place finalization on a deterministic startup hook boundary.
7. Add guardrails for late registration calls after ORM startup.

8. Phase C: Broker/provider wiring
9. Implement actual provider registration in `static-location` and reminder notification provider plugins.
10. Validate broker conflict handling and fallback behavior when no providers are registered.

11. Phase D: Feature migration + hardening
12. Migrate remaining feature plugins incrementally in dependency order.
13. Add startup diagnostics report and policy-violation error formatting.
14. Add built-ins-only fallback switch.

**Relevant files**
- `src/lib/alice-plugin-interface.ts` — canonical interface and unresolved typing/enforcement semantics
- `src/lib/alice-core.ts` — startup integration point for plugin runtime
- `src/lib/user-config.ts` — source for typed system config and future user plugins list loading
- `src/plugins/system-plugins.json` — system plugin load order/required flags
- `src/plugins/memory/memory.ts` — memory capability lifecycle work
- `src/plugins/location-broker/location-broker.ts` — most advanced broker lifecycle behavior
- `src/plugins/weather-broker/weather-broker.ts` — broker consumer of location capability
- `src/plugins/news-broker/news-broker.ts` — broker API aggregation pattern
- `src/plugins/reminders-broker/reminders-broker.ts` — reminder broker API stub
- `src/plugins/static-location/static-location.ts` — provider not yet wired to broker
- `src/plugins/reminders-notification-conversation/reminders-notification-conversation.ts` — provider migration target
- `src/plugins/reminders-notification-libnotify/reminders-notification-libnotify.ts` — provider migration target
- `src/plugins/appointments/appointments.ts` — high-dependency composite migration target
- `src/plugins/daily-goals/daily-goals.ts` — high-dependency composite migration target

**Verification**
1. Loader enforces dependency and capability policies with deterministic errors.
2. Hooks execute in documented order across startup and shutdown.
3. Memory-dependent plugins can register models before ORM init and receive ready callbacks after init.
4. Broker/provider registrations are race-free and conflict behavior is explicit.
5. Built-ins-only startup remains stable and user-plugin list remains optional.

**Decisions (unchanged)**
- Load order remains declaration order for system and user plugin lists.
- Dependencies are mandatory declarations regardless of load-order convenience.
- Plugin ids are canonical; plugin names are display labels.
- Scope remains zero user-facing behavior regression during migration.
