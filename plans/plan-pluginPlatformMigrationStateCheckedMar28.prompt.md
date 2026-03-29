## Plan: Plugin Platform Migration (State-Checked March 28)

The project has moved beyond interface-only scaffolding: a plugin engine skeleton, hook registry, and typed plugin contracts now exist. However, runtime enforcement and startup integration are still the critical blockers. This plan reflects actual code status and reorders execution around completing Phase A first.

**State Snapshot**
- Core contract/types exist in `src/lib/types/alice-plugin-interface.ts` and `src/lib/types/alice-plugin-hooks.ts`.
- Engine scaffolding exists in `src/lib/alice-plugin-engine.ts`.
- Hook registry exists in `src/lib/plugin-hooks.ts`.
- Loader file exists but is empty: `src/lib/alice-plugin-loader.ts`.
- Startup path in `src/lib/alice-core.ts` still does not initialize plugin runtime.
- Brokers are partially implemented and offering APIs, but provider wiring and runtime policy enforcement are incomplete.

**Completed**
1. Canonical plugin identity model implemented (`id` canonical, `name` display label).
2. Dependency shape migrated to `{ id, version | version[] }`.
3. Hook surface is defined across conversation/tool/startup/shutdown callbacks.
4. Capability API shape exists (`offer`/`request`) and module augmentation pattern is in use.
5. System registry drift cleaned (`schedule` removed from `src/plugins/system-plugins.json`).
6. Memory plugin metadata normalized (`Memory Plugin` display name).
7. Broker API offers implemented in:
8. `location-broker`
9. `news-broker`
10. `weather-broker`
11. `reminders-broker`
12. Some feature plugins already register tools (`application`, `scratch-files`, `user-files`).

**In Progress**
1. Engine init logic and plugin insertion exist but are not yet enforcing all policies.
2. Hook registration primitives exist but hook invocation sequencing is not fully wired in runtime.
3. Memory capability API is designed with lifecycle intent, but model-registration and ORM-ready closure remain incomplete.

**Remaining (Rebased)**

Phase A: Runtime enforcement foundation (blocking)
1. Complete `src/lib/alice-plugin-engine.ts` enforcement logic:
2. version resolution (including `LATEST` semantics)
3. engine maintains registry of active plugins, their offered/requested capabilities, registered hooks, and registered tools/prompts
4. Tool/prompt conflicts are detected and rejected at registration time with actionable errors
5. close hook-registration windows at correct lifecycle boundaries
6. make tool/prompt registration paths functional (not no-op)

7. Implement loader in `src/lib/alice-plugin-loader.ts`:
8. Loader enforces manifest schema and dependency validity before inserting into engine with clear actionable errors in cases of violations
9. system plugin manifest loading from `src/plugins/system-plugins.json`
10. optional user plugin list loading from `~/.alice-assistant/plugins.json` (non-fatal if absent)
11. unknown id, missing dependency, and cycle detection with actionable diagnostics
12. loader hands off to engine init when validation passes

13. Integrate plugin runtime into `src/lib/alice-core.ts` startup path:
14. initialize plugin engine before conversation and web/voice readiness (Question: Should we just move voice into a required plugin like we did web chat and get this for free?)
15. execute startup/shutdown hook timeline deterministically

Phase B: Memory lifecycle completion
16. Finalize memory registration lifecycle in `src/plugins/memory/memory.ts`:
17. collect dependent model registrations before ORM init
18. initialize ORM once after plugin registration phase
19. trigger `onDatabaseReady` callbacks after ORM readiness
20. reject late `registerDatabaseModels`/`onDatabaseReady` registration attempts
21. implement `saveMemory` behavior (currently stub/TODO)

Phase C: Broker/provider wiring
22. Wire provider plugins to brokers:
23. `static-location` -> register with `location-broker`
24. `reminders-notification-conversation` -> register notification provider with `reminders-broker`
25. `reminders-notification-libnotify` -> register notification provider with `reminders-broker`
26. validate broker conflict and empty-provider behavior paths

Phase D: Feature completion and hardening
27. Implement currently metadata-only/placeholder plugins:
28. `appointments`
29. `daily-goals`
30. finalize `mood` capability usage path where needed
31. Add runtime diagnostics report:
32. plugin load order and resolved dependencies
33. offered/requested capabilities
34. hook execution summary and violations
35. Add fallback controls:
36. built-ins-only mode switch
37. safe startup behavior when user plugin list is absent/invalid

Phase E: Nice-to-haves
38. "Optional dependencies": I've already run into this with `web-ui`. It's making `mood` a required plugin, when ideally it would be an optional thing users can enable for fun. Add a separate optional dependency declaration. Setting it means plugin registration waits for the optional dependencies to load, if present, and allows plugins to request capabilities from them if they exist, but not fail if they aren't present. This would allow for more flexible plugin ecosystems where certain features can be gated behind optional plugins without hard dependencies.
39. Hot-loading.
40. Monorepo? pnpm?
41. Beef up the web ui with plugin management, general config, and diagnostics surfaces, in addition to the assistant chat. This may require doing the monorepo thing, and then moving the front-end into its own package so it can be built with react and webpack.

**Relevant files**
- `src/lib/alice-plugin-engine.ts` — runtime enforcement and registration behavior
- `src/lib/alice-plugin-loader.ts` — manifest-driven loading (currently empty)
- `src/lib/plugin-hooks.ts` — hook lifecycle closure and execution ordering
- `src/lib/types/alice-plugin-interface.ts` — contract and policy surface
- `src/lib/types/alice-plugin-hooks.ts` — hook signatures
- `src/lib/alice-core.ts` — startup integration point
- `src/plugins/system-plugins.json` — system plugin declaration order and required flags
- `src/plugins/memory/memory.ts` — memory lifecycle and ORM capability integration
- `src/plugins/location-broker/location-broker.ts` — most advanced broker lifecycle pattern
- `src/plugins/weather-broker/weather-broker.ts` — broker capability consumer pattern
- `src/plugins/news-broker/news-broker.ts` — broker aggregation pattern
- `src/plugins/reminders-broker/reminders-broker.ts` — reminder broker API surface
- `src/plugins/static-location/static-location.ts` — provider wiring target
- `src/plugins/reminders-notification-conversation/reminders-notification-conversation.ts` — provider wiring target
- `src/plugins/reminders-notification-libnotify/reminders-notification-libnotify.ts` — provider wiring target
- `src/plugins/appointments/appointments.ts` — high-dependency feature completion target
- `src/plugins/daily-goals/daily-goals.ts` — high-dependency feature completion target

**Verification**
1. Plugin runtime enforces dependency/version/request/offer policies with deterministic failures.
2. Startup/shutdown hooks execute in documented order and registration closes at expected boundaries.
3. Tools/prompts registered by plugins become active in runtime behavior.
4. Memory-dependent plugins can register models pre-init and receive ORM post-init without races.
5. Broker providers successfully register and broker conflict behavior is explicit and tested.
6. Built-ins-only startup remains stable and user plugin list remains optional/non-fatal.

**Decisions**
- Load order remains declaration order (system list first, user list second).
- Dependencies remain mandatory declarations regardless of declaration-order convenience.
- Plugin ids remain canonical; names remain display labels.
- Scope remains zero user-facing behavior regression during migration.
- Phase A is the hard gate for all downstream plugin feature work.
