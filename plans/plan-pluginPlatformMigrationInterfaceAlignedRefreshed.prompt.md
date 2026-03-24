## Plan: Plugin Platform Migration (Interface-Aligned)

The plugin runtime is now past the pure-scaffold stage: the central interface exists in src/lib/alice-plugin-interface.ts, the hook surface is largely defined, and the capability API exists via declaration merging on PluginCapabilities. The plan should now focus on hardening runtime semantics, wiring the existing lifecycle correctly, and integrating the memory and broker capability flows before broad migration of feature plugins.

**Current State**
- The canonical runtime contract now lives in src/lib/alice-plugin-interface.ts.
- Plugin identity is now explicit in AlicePluginMetadata via id, with name reserved for human-friendly display text.
- Dependencies are now structured objects using id plus version or version array.
- The hook surface is already substantial: conversation hooks, tool hooks, startup hooks, and shutdown hooks.
- The capability API exists: offer() and request() are part of the plugin handle, and capabilities are typed through declaration merging on PluginCapabilities.
- memory is now both the reference plugin and the first concrete capability provider in src/plugins/memory/memory.ts.
- datetime remains the main prompt-only reference in src/plugins/datetime/datetime.ts.
- Broker plugins remain mostly structural, so the next planning focus is lifecycle integration and capability semantics rather than inventing new plugin abstractions.
- Registry coverage is still partial: some plugin folders exist but are not yet listed in src/plugins/system-plugins.json, which may be intentional for now.

**Steps**
1. Phase 1: Contract hardening and lifecycle semantics (blocking)
2. Finalize AlicePluginMetadata semantics in src/lib/alice-plugin-interface.ts: id is canonical and stable; name is display-only.
3. Replace getSystemConfig(): any with a typed system config shape sourced from src/lib/user-config.ts.
4. Lock down config<TSchema>() semantics: validation timing, unknown-field policy, defaulting behavior, and error message format.
5. Harden capability semantics already present in the interface:
6. offer() may be called exactly once and only during registerPlugin().
7. request() may only target declared dependencies.
8. request() resolution is deterministic once dependency loading is complete.
9. Policy violations fail clearly with plugin-scoped diagnostics.
10. Define version-resolution semantics for dependency version strings and arrays, including the LATEST system-plugin special case.

11. Phase 2: Runtime ordering and hook execution semantics (depends on Phase 1)
12. Keep plugin loading in declaration order: system plugins from src/plugins/system-plugins.json, then user plugins from ~/.alice-assistant/plugins.json.
13. Wire and document the existing hook surface rather than designing new hooks first.
14. Define exact call order and error propagation for the existing startup/shutdown hooks, prioritizing:
15. onSystemPluginsLoaded
16. onUserPluginsWillLoad
17. onAllPluginsLoaded
18. onAssistantWillAcceptRequests
19. onAssistantAcceptsRequests
20. onAssistantWillStopAcceptingRequests
21. onAssistantStoppedAcceptingRequests
22. onPluginsWillUnload, onUserPluginsUnloaded, and onSystemPluginsWillUnload
23. Treat onToolWillBeCalled and onToolWasCalled as observability hooks first, not mutation hooks.

24. Phase 3: Memory lifecycle and database capability integration (depends on Phase 1 and 2)
25. Make memory the first fully operational capability provider.
26. Finalize the memory capability contract in src/plugins/memory/memory.ts:
27. registerDatabaseModels()
28. onDatabaseReady()
29. Define the exact lifecycle point where dependent plugins may register ORM models and readiness callbacks.
30. Initialize MikroORM only after all plugins that depend on memory have had a chance to register models.
31. After ORM startup, close the registration window and make late registerDatabaseModels/onDatabaseReady calls fail clearly.
32. Use the existing startup hooks to place this flow precisely, most likely around onAllPluginsLoaded.

33. Phase 4: Broker integration after memory lifecycle is stable (depends on Phase 3)
34. Implement broker capability contracts after the shared capability lifecycle is proven with memory.
35. location-broker: single-provider registration and arbitration semantics.
36. reminders-broker: reminder source registration plus notification channel registration.
37. weather-broker, news-broker, and web-search-broker: provider registration and dispatch contracts.
38. Keep broker APIs typed through PluginCapabilities augmentation, matching the pattern memory now uses.

39. Phase 5: Feature plugin migration in dependency order (depends on Phase 4)
40. First migrate lower-dependency built-ins: system-info, scratch-files, user-files, application, mood.
41. Then migrate provider plugins: static-location, reminders-notification-conversation, reminders-notification-libnotify.
42. Migrate broker consumers after their broker contracts are live.
43. Leave highest-dependency composites for last: appointments and daily-goals.
44. Preserve existing tool names, availability contexts, prompt ordering, and tool-setting file semantics throughout migration.

45. Phase 6: Hardening and rollout controls (parallel with late Phase 5)
46. Add startup diagnostics covering plugin ids, display names, dependencies, offered capabilities, registered tools, registered prompts, and hook registrations.
47. Fail fast on missing required dependencies, privilege violations, dependency cycles, invalid capability requests, and lifecycle violations.
48. Keep user plugin loading optional; missing ~/.alice-assistant/plugins.json is non-fatal.
49. Add a built-ins-only fallback switch to disable user plugins quickly.

**Relevant files**
- src/lib/alice-plugin-interface.ts — canonical plugin contract, hooks, config access, identity fields, and capability API
- src/plugins/system-plugins.json — declaration-order system plugin registry and required flags
- src/plugins/memory/memory.ts — first real capability provider and tool/prompt reference implementation
- src/plugins/datetime/datetime.ts — prompt-only reference plugin
- src/lib/user-config.ts — source for typed system config and future user plugins.json loading
- src/lib/alice-core.ts — startup orchestration and plugin lifecycle integration point
- src/plugins/location-broker/location-broker.ts — broker contract candidate for provider arbitration
- src/plugins/reminders-broker/reminders-broker.ts — broker contract candidate for source/notification registration
- src/plugins/news-broker/news-broker.ts — broker consumer/provider dependency example
- src/plugins/weather-broker/weather-broker.ts — broker consumer/provider dependency example
- src/plugins/web-search-broker/web-search-broker.ts — broker boundary for search providers
- src/plugins/appointments/appointments.ts — high-dependency composite migration target
- src/plugins/daily-goals/daily-goals.ts — high-dependency composite migration target

**Verification**
1. Plugin identity is unambiguous: loader registry, dependencies, and capability requests all resolve using the same canonical id.
2. Plugin metadata remains readable without executing side effects.
3. getSystemConfig() is fully typed for plugin consumers.
4. config<TSchema>() fails at load time with actionable plugin-scoped errors.
5. offer()/request() policy is enforced and invalid cross-plugin requests fail clearly.
6. Memory-dependent plugins can register ORM models before database startup and receive ORM access after readiness without races.
7. Existing hooks execute in deterministic order with documented fatal vs non-fatal behavior.
8. Built-ins-only startup behavior remains stable while plugins are migrated.
9. User plugin loading remains optional and non-fatal when no user plugin list exists.

**Decisions**
- Load order remains declaration order for both system and user plugin lists.
- Dependencies remain mandatory declarations even when load order already satisfies them.
- The current hook surface is sufficient for now; the work is to wire and define semantics, not add more hooks preemptively.
- Memory is the first capability-lifecycle proving ground and should be completed before broker APIs.
- Broker plugins still migrate before their high-dependency consumers, but after memory lifecycle semantics are stable.
- Plugin ids are canonical; plugin names are display labels.
- Scope remains zero user-facing behavior regression during core migration.
