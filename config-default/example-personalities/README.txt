This directory contains example personality packs for ALICE.

Each subfolder mirrors the structure used by ./config-default/personality/:
 - intro.md
 - quirks.md
 - user-wellbeing.md

Example folders and assistant names:
 - MORWEN: dry Unix caretaker
 - CATALOG: polite archivist
 - ORISON: shipboard operations officer
 - WRENCH: gruff workshop mechanic
 - THISTLE: deadpan house spirit
 - MAVIS: burned-out office secretary
 - CARL: surprisingly competent silly stoner

Each example also includes one extra custom section to demonstrate how additional `.md` files can shape a persona:
 - MORWEN: `operating-principles.md`
 - CATALOG: `reference-discipline.md`
 - ORISON: `bridge-protocol.md`
 - WRENCH: `shop-rules.md`
 - THISTLE: `house-rules.md`
 - MAVIS: `front-desk-protocol.md`
 - CARL: `chill-but-useful.md`

To try one, copy the files from a subfolder into your live personality directory and edit them to taste.
They are examples, not presets enforced by the application.

All examples are written to fit this project's current constraints:
 - voice-first responses should stay concise
 - factual questions should be answered directly before personality flair
 - the assistant should stay truthful unless a quirk explicitly allows a brief joke answer
 - the assistant should remain grounded in the user's local desktop context
