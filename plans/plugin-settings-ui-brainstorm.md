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
   - enabled/disabled toggle
   - status badge such as required, optional, experimental, or user plugin

2. Add an inline warnings area per plugin entry.
   - Warning text appears only when the current enabled set triggers a known soft conflict.
   - Warnings should not prevent saving.

3. Add a save/apply action with restart guidance if necessary.
   - Some plugin changes may require a restart.
   - UI should say that explicitly rather than pretending changes are hot-loaded.

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
   - SOFT BLOCKER: peer and optional dependencies for plugins are on the feature roadmap. It will *probably* be easier to do this after those are in place, but proceed if you are confident the later retrofit won't be too difficult.
   - HARD BLOCKER: I'm seriously considering splitting the built-in plugins into "system" and "community" subsets, to sort them into things most people want for basic functionality, and functionality expected to be broadly useful, but still somewhat specific, or even niche (`moltbook` being more niche, lol. And maybe, if I'm really lucky, even actual contributions from other users). Since this split will be reflected in the UI. This decision needs to be finalized before the UI work starts. DO NOT PROCEED WITH THE UI WORK WHILE THIS BULLET POINT IS PRESENT IN THIS PLAN, UNLESS THE PLUGINS DIRECTORY HAS SUBDIRECTORIES NAMED "system" AND "community" AND ALL CURRENT PLUGINS ARE SORTED INTO ONE OF THOSE TWO DIRECTORIES APPROPRIATELY, IN WHICH CASE THE SPLIT HAS BEEN COMPLETED AND THE UI DESIGN SHOULD REFLECT IT. IF THE PLUGINS DIRECTORY SEEMS TO HAVE ADDITIONAL CATEGORIES BESIDES THOSE TWO UNDER IT, ASK THE USER HOW TO PROCEED FIRST. Dear human: In the unlikely case we decide not to do this split, please remove this bullet point.
   - SOFT BLOCKER: The loading process for user plugins exists, but is untested. We can work on this UI without that, but it would impact testing.

## Open Questions

1. Should plugin descriptions come directly from plugin metadata, or should there be a richer UI-specific description field? Answer: Metadata for now, though a link to read (pretty-rendered using the already present markdown renderer) the plugin's README.md (if it has one) in a sort of "next page" of the existing (currently mostly empty) config panel overlay, with a "back" arrow to go back to the main list, would be a nice-to-have that also encourages plugin authors to write good READMEs. It will probably be a good idea to have the panel expand to the left a bit for this interaction, for a better reading experience, ideally enough for about 80-120 characters per row, and I'd like this transition to be smooth.
2. Should warnings be computed fully on the backend, or is it acceptable for the frontend to evaluate simple declarative rules? Answer: Simple rules can be evaluated on the frontend for responsiveness, and warnings should be computed solely on the front-end whenever reasonable, but for "hard" error conditions the backend should still be verifying everything, even when the front-end checks for simple issues pre-flight for responsiveness.
3. When plugin-specific settings pages arrive, should they live inline in the plugin list or behind per-plugin detail views? Answer: For consistency, let's make it always live in a separate details view.
