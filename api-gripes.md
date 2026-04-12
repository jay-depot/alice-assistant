### Rough edges

1. Declared conversation and tool hooks are effectively dead API right now.

Impact: Plugin authors can register callbacks that look first-class in the public contract, but there is no core call path invoking them. That makes the API misleading and pushes failures into silent non-behavior instead of startup errors.

Evidence path(s): src/lib/types/alice-plugin-hooks.ts, src/lib/plugin-hooks.ts, src/plugins/memory/memory.ts

Smallest practical fix: Either wire these hooks into the real conversation and tool execution flow immediately, or remove or deprecate them from the exported type surface until they are actually invoked.

2. Hook registration timing is undocumented in practice and contradicts the apparent contract.

Impact: The API reads like hooks are registration-time declarations, but actual behavior allows some hooks to be added later as long as the relevant lifecycle event has not fired yet. That creates order-sensitive plugins and forces authors to learn hidden timing rules from built-in examples.

Evidence path(s): src/lib/plugin-hooks.ts, src/plugins/memory/memory.ts

Smallest practical fix: Pick one rule and enforce it. Either close all hook registration after plugin init finishes, or explicitly support phase-based late registration and document which hooks remain open until which lifecycle boundary.

3. The registerPlugin handshake has a redundant metadata argument that can diverge from the plugin's real metadata.

Impact: A plugin already exposes pluginMetadata on the top-level AlicePlugin object, but the runtime API asks authors to pass metadata again into registerPlugin. The engine then uses the passed object for dependency waiting while using the captured plugin metadata for identity and errors. A mismatch can produce opaque crashes instead of a clear validation error.

Evidence path(s): src/lib/types/alice-plugin-interface.ts, src/lib/alice-plugin-engine.ts

Smallest practical fix: Remove the registerPlugin parameter and use the enclosing plugin metadata only. If you want a guardrail during transition, assert deep equality and throw a descriptive error when they differ.
