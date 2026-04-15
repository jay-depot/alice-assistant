# Personality Plugin Ideas

> **Status (2026-04-14): ONE IDEA PARTIALLY IMPLEMENTED.** "Facets" has a community plugin (`personality-facets` at `src/plugins/community/personality-facets/`) that exists but needs verification. The "Evolving Personality", "Match the User's Energy", "Persona Marketplace", and "Multi-Agent Personality" concepts have NOT been started.

These are follow-on concept notes for personality-provider plugins that could exist after the core personality migration is complete. They are intentionally separate from the migration plan so the phase-one work stays focused on the default plugin extraction and the core integration contract.

## Shared Assumptions

- Only one personality provider should be active at a time in the first version of the pluginized personality system.
- The personality integration API should not care whether a plugin stores its state in files or in the database.
- Static personality plugins should generally use filesystem-backed content.
- Assistant-managed personality plugins should generally use database-backed state.

## Facets

### Summary

A plugin that exposes a small set of stable core personality principles plus a library of temporary or situational facets. The assistant can call `createFacet`, `embodyFacet`, `adjustFacet`, and `discardFacet` based on the current conversation on the fly, and only the core principles plus the active facet instructions are injected into the prompt in any given conversation round.

### Why it is interesting

- This is the most immediately useful alternative and the first likely follow-up implementation.
- It creates a more dynamic personality system without requiring the whole personality to become mutable.
- It offers a concrete stress test for whether the migration produced the right personality-provider contract.
- It's potentially _useful_ because it lets the assistant adapt to different conversation contexts without losing its core identity, including learning when to be more professional, casual, playful, or serious based on situational, or current-task based triggers the assistant creates as part of each facet.

### Technical Implications

- Personality injection likely needs access to a conversation or session identifier so the plugin can decide which facet is active for a given conversation.
- Tools such as an `embodyFacet`-style tool need to know which conversation invoked them so they update the correct conversation-scoped state.
- Conversation-scoped personality state will need to survive restarts, which implies a database table for per-conversation personality state.
- Related session-aware systems, including agent handoff or session-linked agent workflows, may need the same conversation identity model.

### Open Questions

- What is the canonical conversation identifier for plugin-owned conversation state?
- Should a facet be chosen explicitly by tool call, inferred from context, or both?
- How much state belongs in the database versus in-memory cache?
- How should a facet plugin behave when a conversation starts without a prior active facet?

### Priority

High. This is the first serious post-migration experiment.

## Evolving Personality

### Summary

A plugin that seeds the assistant with a static starting personality, copies that state into the database on first startup, and then allows the assistant to modify that personality over time. The current stored version is what gets injected into the prompt.

### Why it is interesting

- It appears to be one of the simplest non-static follow-up plugins once the migration is done.
- It tests whether the personality-provider API can support assistant-managed state cleanly.
- It makes it possible to observe how the assistant chooses to evolve when given broad authority to do so.

### Technical Implications

- Needs persistent database-backed personality state.
- Needs one or more tools for updating the stored personality safely.
- Probably benefits from a seeded initial personality template that may also include broad instructions on how the assistant should decide to change itself.

### Open Questions

- What constraints should exist on self-modification?
- Should changes be append-only, revisioned, or fully editable in place?
- Should the user be able to inspect or roll back personality revisions?

### Priority

Medium-high. Likely straightforward after the migration.

## Match the User's Energy

### Summary

A plugin that starts from a minimal base personality and relies on instructions plus plugin tools to gradually adapt persona notes in response to the user over time.

### Why it is interesting

- It is effectively a lighter-weight variant of the evolving personality concept.
- It pushes the assistant toward adaptive behavior without requiring a large seeded personality.
- It could be a good test of how little fixed scaffolding a personality plugin actually needs.

### Technical Implications

- Likely uses the same underlying storage and update mechanics as the evolving personality plugin.
- Probably needs a static code-defined instruction block for the core adaptation rule, such as matching the user's energy and updating frequently.
- May need stronger guardrails to avoid drift, flattery loops, or unstable persona changes.

### Open Questions

- How much of the behavior should be fixed in code versus learned in stored notes?
- What prevents overfitting to short-term user mood or noisy interactions?
- Should this plugin adapt globally, per user, or per conversation?

### Priority

Medium. Conceptually simple, but probably needs more behavioral guardrails than it first appears.

## Persona Marketplace

### Summary

A plugin that lets users browse, install, and switch between pre-built static personalities, likely using an external source of personality packages.

### Why it is interesting

- It could make the system more approachable if there is ever a substantial user base.
- It creates a natural distribution mechanism for community-authored static personalities.
- It could double as a reference implementation for importing and validating plugin-owned filesystem content.

### Technical Implications

- Most likely backend is a GitHub-based index or repository model if this is ever built.
- Needs package discovery, install, update, and selection UX.
- Needs trust and validation rules for downloaded personality content.

### Open Questions

- Is this a plugin that distributes personality files, or a plugin that distributes personality-provider plugins?
- What metadata and review rules are required before installation?
- How much of this should be UI-driven versus config-driven?

### Priority

Low unless the project unexpectedly grows a large user base.

## Multi-Agent Personality

### Summary

A plugin that allows multiple distinct personalities to be defined and includes rules for selecting which one should be active in a given situation.

### Why it is interesting

- It is the most ambitious version of the idea space.
- It could support richer situational behavior than a single mutable personality.
- It would force a more general solution to personality selection and mode switching.

### Technical Implications

- Requires a policy layer for choosing the active personality.
- Requires careful thought about whether provider selection is still a single-provider model internally or a coordinator plugin managing multiple sub-personas.
- May overlap with the facets concept, depending on how strong and separate the personalities are meant to be.
- Requires most of the same technical prerequisites as the facets plugin, in terms of tools being able to know what conversation they've been called from, maintenance of per-conversation state, and conversation-id-aware personality rendering.

### Open Questions

- Is this truly multiple personalities, or just a more structured version of facets?
- How are selection rules authored and debugged?
- How visible should persona switching be to the user?

### Priority

Low for now. It is interesting, but it should probably wait until the simpler plugin forms prove out the API, and it's kind of just "facets but static" anyway.
