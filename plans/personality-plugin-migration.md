# Personality Plugin Migration

Migrate personality prompt generation out of core and into a required system plugin, while keeping prompt injection semantics and the existing user personality directory intact for the first version. The recommended approach is to split the current behavior into two concerns: a plugin-owned personality content loader and renderer, and a small core-owned integration surface that consumes rendered personality text both in normal conversations and in notification voice rendering. The first iteration should explicitly support exactly one active personality provider.

## Goals

- Move the default personality implementation into a plugin.
- Keep the current prompt placement and conversation-type behavior intact.
- Preserve the current user-facing personality directory for the first migration.
- Create a path for alternative personality implementations later without over-designing the first version.

## Decisions

- Keep `~/.alice-assistant/personality` as the source of truth for the first migration; do not move content into plugin settings yet.
- Enforce a single active personality provider in the first version; do not support multi-plugin composition yet.
- Use a small core-owned notification integration surface rather than a plugin capability API for notification rendering.
- Keep `includePersonality` in conversation-type definitions because it is a generic conversation-policy control, not an implementation detail of the default plugin.
- Treat personality storage as plugin-owned. Static personality plugins should store their content in the filesystem, while assistant-managed personality plugins should store their content in the database. The personality integration API should remain storage-agnostic.
- Treat the new personality plugin as required so the assistant cannot boot without a base persona implementation.

## Plan

1. Define the target architecture and ownership boundary before moving code. The plugin should own discovering personality markdown files, normalizing section names, and rendering the canonical personality prompt text. Core should retain only generic prompt orchestration and notification rendering hooks.
2. Introduce a required `personality` system plugin under `src/plugins/personality` that encapsulates the current logic now split between `user-config.ts`, `personality-header.ts`, and `render-chat-notification.ts`. It should register the header system prompt used in regular conversations and become the default implementation of the personality system.
3. Preserve the existing on-disk source of truth at `~/.alice-assistant/personality` for the initial migration. The new plugin should read the existing directory directly so current installs continue working without any file migration step.
4. Remove core's direct ownership of personality loading from `src/lib/user-config.ts` and `src/lib/types/system-config-full.ts`, or reduce those surfaces to temporary compatibility shims only if startup order requires it. The end state should be that `UserConfig` still owns general assistant config, but not the loaded personality record.
5. Replace the hardcoded header registration path in `src/lib/header-prompts.ts` by deleting the built-in `personalityHeaderPrompt` import and allowing the plugin engine to be the only source of personality header prompts. Keep `includePersonality` in conversation-type definitions so core still controls whether a conversation type wants personality content at all.
6. Add a narrow core-owned integration surface for notification voice rendering so personality-specific text can still be injected into `src/lib/render-chat-notification.ts` without duplicating loading logic. Recommended shape: a generic registration point in core for a rendered personality prompt provider or a pre-rendered prompt cache populated by the required personality plugin during startup.
7. Refactor `src/lib/render-chat-notification.ts` to consume the new core integration surface instead of rebuilding personality text from `UserConfig.getConfig().personality`. Preserve existing behavior for title and message handling and only swap out the personality source.
8. Register the new plugin in `src/plugins/system-plugins.json` as `required: true` so startup behavior remains equivalent to today's built-in personality requirement. If plugin loading fails, assistant startup should fail rather than silently losing the base persona.
9. Enforce the initial single-provider rule explicitly. The plugin engine or registration helper should reject multiple personality providers with a descriptive error.
10. Update documentation and migration notes after the code path is stable. The plan and README-adjacent documentation should explain that personality is now implemented as a plugin, but the user-facing personality files remain in the same directory for now.

## Relevant Files

- `plans/personality-plugin-migration.md`: final architectural plan and decision record.
- `src/lib/user-config.ts`: remove or minimize direct personality loading so user config stops owning plugin content.
- `src/lib/types/system-config-full.ts`: deprecate or remove the `personality` field once the plugin owns runtime loading.
- `src/lib/system-prompts/headers/personality-header.ts`: source logic to migrate into the plugin and likely delete afterward.
- `src/lib/header-prompts.ts`: remove the hardcoded personality prompt import and registration.
- `src/lib/render-chat-notification.ts`: replace duplicate prompt-building logic with the new core integration surface.
- `src/lib/conversation-types.ts`: preserve and validate `includePersonality` as the conversation-level opt-in or opt-out switch.
- `src/lib/types/alice-plugin-interface.ts`: reference for prompt registration patterns; extend only if a generic provider registration surface belongs there.
- `src/plugins/system-plugins.json`: add the new required system plugin.
- `src/plugins/system/skills/skills.ts`: reference pattern for plugin-owned prompt generation from user-managed markdown content.
- `src/plugins/system/scratch-files/scratch-files.ts`: reference pattern for filesystem-backed prompt content in a plugin.
- `src/plugins/community/mood/mood.ts`: reference pattern for conditional prompt generation and plugin registration lifecycle.
- `src/plugins/system/memory/memory.ts`: verify whether the `includePersonalityChangeLlmHint` wording still makes sense after the migration.
- `config-default/personality`: keep as the scaffolded default user content source for the first migration.

## Verification

1. Confirm the assistant still scaffolds `~/.alice-assistant/personality` on first run and that the new plugin can read it without `UserConfig` preloading a runtime personality map.
2. Verify normal chat prompt assembly still includes the personality header for conversation types with `includePersonality: true`, and excludes it where `includePersonality: false`.
3. Verify the notification voice-rendering path still receives personality text and no longer contains duplicated markdown-to-prompt assembly logic.
4. Verify startup fails clearly if the required `personality` plugin is missing or fails to register.
5. Run the project's normal validation commands for touched code paths, at minimum a TypeScript build and ESLint on affected source.
6. Manually review for any remaining core references to `UserConfig.getConfig().personality` and decide whether any compatibility shim is temporary or should be removed before merge.

## Future Plugin Ideas

- See `plans/personality-plugin-ideas.md` for organized concept notes on future personality-provider plugins.
- Candidate directions currently include: Facets, Evolving Personality, Match the User's Energy, Persona Marketplace, and Multi-Agent Personality.

## Further Considerations

1. When the project is ready for alternative personality implementations, add a second-phase design for provider selection and lifecycle rules instead of over-generalizing the first migration.
2. Future personality plugins should follow the storage convention established above: static personalities live in the filesystem, assistant-managed personalities live in the database, and the API exposed to the rest of the system should not reveal which backend is in use.
3. If the notification integration surface proves useful beyond personality, generalize it later into a reusable rendered-prompt provider abstraction rather than designing that abstraction up front.
