# Plugin Settings UI Brainstorm

## Goal

Sketch a future web UI surface for plugin configuration, with room for soft-conflict warnings and plugin-specific guidance before implementation details harden.

## Desired Outcomes

1. Let users inspect which plugins are enabled without manually editing JSON.
2. Make plugin descriptions visible in the UI, including caveats and "this may annoy you" guidance.
3. Surface soft conflicts as warnings instead of startup errors when combinations are allowed but potentially unpleasant.
4. Leave room for plugin-specific config editors later without blocking on the full generic solution now.

## Soft Conflict Examples

1. `notifications-chat-interruption` + `notifications-chat-initiate`
   - Allowed.
   - Warning text should explain that both may deliver the same notification in different ways and may become noisy.

2. `notifications-chat-initiate` + `notifications-chat-segue`
   - Allowed.
   - Warning text should explain that notifications may appear both as new chats and as prompt-injected reminders.

3. Any future combination of multiple aggressive notification plugins
   - Allowed unless there is a true technical conflict.
   - UI should prefer warnings over hard blocks for this class of issue.

## First-Pass UI Ideas

1. Add a simple Plugins page or Settings section listing:
   - plugin name
   - short description
   - enabled/disabled toggle (Which will be itself disabled if the plugin is required or has enabled dependents, with an explanation tooltip on hover)
   - "Type" badges for system+required, system+optional, community, or user plugin
   - "Warning" badges for the highest "level" of registered agentic independence included in the plugin. Something akin ski diamonds for the overall level (DO NOT RELY SOLELY ON COLOR FOR THIS. COLOR _AND_ AN ADDITIONAL VISUAL SIGNAL LIKE THE NUMBER OF [CHOSEN_ICON] OR [CHOSEN_ICON] WITH CLEAR "PLUSES" AFTERWARDS IS IDEAL), plus additional badges for any specific agentic functionality we end up tracking in the metadata (See `plans/agent-dispatching.md` for more on this)
     - Candidates for the "level" badge include:
       - Robot heads, or a single robot head, followed by 0, 1 or 2 plusses (I'm partial to this, specifically the latter option. Using a robot head is cute and funny, which makes it on-brand. We don't use robot heads anywhere else yet, so the user can learn this is the idiom. The plusses are a better alternative to repeating robot heads, which might imply more _agents_, rather than more _agency_)
       - Gears
       - Diamonds (like ski resort difficulty ratings, but for the agent's independence level instead of slope difficulty)

2. Add an inline warnings area per plugin entry.
   - Warning text appears only when the current enabled set triggers a known soft conflict.
   - Warnings should not prevent saving.

3. Add a save/apply action with restart guidance if necessary.
   - Most (probably all) plugin changes require a restart. Hot loading is a far-future "maybe" goal.
   - UI should say that explicitly rather than pretending changes are hot-loaded.
   - Nice to have: A way for this thing to manage its own restart when changes require one.

## Data Model Thoughts

1. Extend plugin metadata or introduce a derived registry for UI-facing fields such as:
   - display description
   - category
   - warning rules
   - experimental status

2. Represent soft conflicts as declarative rules where practical.
   - Example: plugin A + plugin B => warning message
   - This should live near plugin metadata or in a small registry, not buried in UI-only code.

3. Keep actual config persistence compatible with `enabled-plugins.json`.
   - The UI will be a friendlier editor for the existing config files, which the user should always be able to explore, and edit directly if desired or needed.
   - HARD BLOCKER: All remaining legacy tool configs need to be migrated into their plugins or this cannot work. If you are not confident this has been done completely, DO NOT PROCEED WITH THE UI WORK.
   - SOFT BLOCKER: peer and optional dependencies for plugins are on the feature roadmap. It will _probably_ be easier to do this after those are in place, but proceed if you are confident the later retrofit won't be too difficult.
   - RESOLVED: Built-in plugins are now split into `src/plugins/system/` and `src/plugins/community/`, and the UI design should reflect that distinction rather than assuming a flat built-in plugin directory.
   - SOFT BLOCKER: The loading process for user plugins exists, but is untested. We can work on this UI without that, but it will impact testing scope if that turns out to have been broken all along.

## Open Questions

1. Should plugin descriptions come directly from plugin metadata, or should there be a richer UI-specific description field? Answer: Metadata for now, though a link to read the plugin's README.md (if it has one, pretty-rendered using the already present markdown renderer) in a sort of "next page" of the (by that point will be) existing config panel overlay, with a "back" arrow to go back to the main list, would be a nice-to-have. It would also encourage plugin authors to write good READMEs. It will probably be a good idea to have the panel expand to the left a bit for this interaction, for a better reading experience, ideally enough for about 80-120 characters per row, and I'd like this transition to be smooth.
2. Should warnings be computed fully on the backend, or is it acceptable for the frontend to evaluate simple declarative rules? Answer: Simple rules can be evaluated on the frontend for responsiveness, and warnings should be computed solely on the front-end whenever reasonable, but for "hard" error conditions the backend should still be verifying everything, even when the front-end checks for simple issues pre-flight for responsiveness.
3. When plugin-specific settings pages arrive, should they live inline in the plugin list or behind per-plugin detail views? Answer: For consistency, let's make it a link to a "next page" from the plugin list every time. Most plugins won't have huge lists of settings, but a few might, and it's easier to just assume we'll need the extra space for all of them rather than trying to do a hybrid approach where some have inline settings and some have separate pages. This also keeps the main plugin list cleaner and more scannable.
