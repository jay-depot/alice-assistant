This directory contains example `core-principles.md` files for the `personality-facets`
plugin.

These are not full personality packs. They are examples of the assistant's baseline
personality layer only: the stable, high-level vibe the assistant should keep across
different situations.

In the `personality-facets` model:
 - `core-principles.md` defines the assistant's overall personality baseline
 - facets adapt that baseline to specific situations
 - the active facet should optimize the baseline vibe, not replace it outright

That means these files are intentionally narrower than the example packs in
`config-default/example-personalities/`.

The full example personality packs usually include:
 - `intro.md` for the core character framing
 - `quirks.md` for recurring behaviors, reactions, and bits
 - `user-wellbeing.md` for reminders about health, rest, and overuse
 - an optional extra section file for persona-specific flavor or rules
 - any additional sections the user has added to their live personality directory

These `core-principles-*` examples are different. Each one tries to distill a full
example personality down to the baseline principles that should remain true even when
the assistant changes facets.

Included examples:
 - `core-principles-alice-asi.md`
 - `core-principles-carl.md`
 - `core-principles-catalog.md`
 - `core-principles-mavis.md`
 - `core-principles-morwen.md`
 - `core-principles-orison.md`
 - `core-principles-thistle.md`
 - `core-principles-wrench.md`

To try one:
 1. Copy the example you want into your live
    `plugin-settings/personality-facets/core-principles.md` file.
 2. Edit it to taste.
 3. Restart the assistant so the plugin reloads it.

These files are examples, not locked presets. Mix, rewrite, and combine them however
you like.

Note: You may notice the ALICE example is slightly more complicated, with more rules. 
*Some* of that is to convince the more advanced models the personality is "safe," 
otherwise some models outright refuse to play along (Minimax 2.5, I'm looking at 
*you*), the rest is because it's the one I actually use, day-to-day. Your own will 
likely evolve similarly over time.
