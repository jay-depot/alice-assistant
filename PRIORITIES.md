# A.L.I.C.E. Assistant — Outstanding Feature Priorities

_Last updated: 2026-04-14_

## What's Done

| Feature                                                                     | Status                                 |
| --------------------------------------------------------------------------- | -------------------------------------- |
| Internal plugin split (system vs community)                                 | DONE                                   |
| Personality plugin migration                                                | DONE                                   |
| Voice interaction                                                           | GOOD ENOUGH FOR NOW                    |
| Task Assistants framework (`TaskAssistants`)                                | DONE                                   |
| Brainstorm plugin                                                           | DONE                                   |
| Session-linked agents (`AgentSystem`)                                       | DONE                                   |
| Deep-dive agent plugin                                                      | PARTIAL (session-linked only)          |
| Tool Call Visibility (all 5 phases)                                         | DONE                                   |
| Notifications: broker, console, segue                                       | DONE (segue needs testing + read tool) |
| Notifications: interruption & initiate                                      | IMPLEMENTED (needs e2e testing)        |
| Plugin architecture (hooks, tools, conversations, task assistants, agents)  | DONE                                   |
| Conversation types (voice, chat, startup, autonomy + plugin-registered)     | DONE                                   |
| Personality system (fallback/override providers, `renderPersonalityPrompt`) | DONE                                   |
| `personality-facets` community plugin                                       | EXISTS (needs verification)            |
| Web UI (Express, WebSocket, React, chat sessions, tool call display)        | DONE                                   |

---

## CRITICAL

### 1. Notifications End-to-End Verification

**Plan:** `plans/notifications-chat-interruption-initiate-test-plan.md`

The interruption and initiate plugins are implemented but the 7-item test plan has never been formally run. Race conditions in chat turn interleaving and session targeting are correctness-critical. No structural blockers — this needs manual and integration testing.

**What to verify:**

- Interruption prefers latest existing session, falls back to new session
- Initiate always creates a new session
- Queuing while a chat turn is in progress (no interleaving)
- Frontend update detection without manual refresh
- LLM-rendered voice rendering and plain-text fallback
- Dual-enablement behavior (both plugins active simultaneously)

### 2. Notifications Chat Segue: Pending Notifications Read Tool

**Plan:** `plans/notifications-chat-segue-next-steps.md` (action item 3)

Users cannot currently ask "what notifications are pending?" and get a direct answer. Need a read-only tool or stronger system-prompt guidance so the assistant can surface pending notifications on demand.

---

## HIGH

### 3. Notifications Chat Segue: Prompt Tuning

**Plan:** `plans/notifications-chat-segue-next-steps.md` (action item 2)

The segue prompt needs live testing to verify the assistant naturally mentions pending notifications. Adjust based on observed failure modes (repeating the same notification, dumping the full list, ignoring pending items entirely).

### 4. Agent Dispatching: V1 Invariants Enforcement

**Plan:** `plans/agent-dispatching.md` — Hard Invariants for V1

Only session-linked agents are currently implemented. The hard invariants (no undeclared agents at runtime, minimal tool access enforced, session-linked agents don't outlive sessions, destructive action prevention) need to be verified and, where not enforced in code, made enforceable.

**Invariants to verify:**

1. Transports are not agents — currently holds by architecture
2. Session-linked agents don't outlive their linked session — `cancelBySession` exists but needs e2e verification
3. Scheduled-session agents don't perform destructive actions directly — not yet applicable (no scheduled-session agents)
4. Agent tool access is explicit and minimal — not enforced in code currently
5. Plugins must not be allowed to register undeclared agents at runtime — not enforced

### 5. Agent Dispatching: Lifecycle State Model

**Plan:** `plans/agent-dispatching.md` — §1 Agent identity and lifecycle

Currently only `running`/`cancelled`/`erroring`/`completed` exist. Missing lifecycle states:

- `needs input` (session-linked, waiting for user)
- `handoff pending` (scheduled-session, waiting for session creation)
- `stuck` (no output or tool calls for a time threshold)
- `sleeping` (independent, intentionally idle)
- `paused` (independent, paused by user)
- `hatching` (independent, starting for the first time)
- `freezing` (independent, preserving state before shutdown)
- `thawing` (independent, restoring state after restart)
- `forking to chat` (independent, requesting a handoff)

This is a prerequisite for scheduled-session and independent agents.

### 6. Plugin Settings UI

**Plan:** `plans/plugin-settings-ui-brainstorm.md`

No way to manage plugins from the web UI. Users must hand-edit JSON files. This is a major usability gap.

**Hard blocker:** All remaining legacy tool configs must be migrated into plugins before this can proceed.

**Soft blockers:**

- Peer and optional plugin dependencies are not yet implemented
- User plugin loading is untested

**Desired features:**

- Plugin list with name, description, enabled/disabled toggle
- Soft conflict warnings (e.g., dual notification plugins)
- Type badges (system+required, system+optional, community, user)
- Per-plugin detail pages with README rendering
- Restart guidance after changes

---

## MEDIUM

### 7. Agent Dispatching: Scheduled-Session Agents

**Plan:** `plans/agent-dispatching.md` — Agent Types §2

Agents that wake up on schedule, gather context, and decide whether a handoff to an interactive session is needed. Requires lifecycle states `armed` and `handoff pending` plus the full state model from priority #5.

**Depends on:** Lifecycle state model (#5) and V1 invariants (#4).

### 8. Agent Dispatching: Independent Agents

**Plan:** `plans/agent-dispatching.md` — Agent Types §3

Long-running background agents with full persistence across restarts. Requires `hatching`, `running`, `freezing`, `thawing`, `paused`, `sleeping`, `forking to chat` lifecycle states.

**Depends on:** Lifecycle state model (#5) and V1 invariants (#4).

### 9. Agent Dispatching: Agent Management Dashboard

**Plan:** `plans/agent-dispatching.md` — §7 UI Implications

The web UI has `ActiveAgentsPanel.tsx` for session-linked agents, but there is no dashboard for viewing, supervising, or controlling scheduled-session and independent agents.

**Depends on:** Scheduled-session agents (#7) and independent agents (#8).

### 10. Personality: Facets Plugin Verification

**Plan:** `plans/personality-plugin-ideas.md` — Facets

The `personality-facets` community plugin exists but needs end-to-end verification: does it correctly use the personality-provider API, support conversation-scoped state, and work alongside the default personality plugin?

**Priority:** Medium-high — "first serious post-migration experiment" per the plan.

### 11. Personality: Evolving Personality Plugin

**Plan:** `plans/personality-plugin-ideas.md`

A personality plugin that seeds from static files, copies to DB, and allows the assistant to modify its personality over time.

**Depends on:** Facets plugin (#10) proving out the personality-provider API.

### 12. Mood Plugin Split

**Plan:** `plans/grand-plan.md` — Random web UI improvements

Split the `mood` plugin into mood tracking (data storage) and mood display (visualization), allowing multiple non-conflicting display plugins.

**Priority:** Medium — UX improvement with low architectural risk.

---

## LOW

### 13. MCP Client Plugin

**Plan:** `plans/grand-plan.md` — MCP

Create an MCP client plugin allowing users to connect to MCP servers and plugins to declare MCP server dependencies.

**Priority:** Low — powerful but for advanced users, large scope.

### 14. ACP/MCP (Alice Coordination Protocol)

**Plan:** `plans/grand-plan.md` — ACP/MCP

Multi-instance coordination, task delegation, and cross-instance messaging. Entirely conceptual at this point.

**Priority:** Low — aspirational, very large scope.

### 15. Future Agent Plugins

**Plan:** `plans/future-agent--plugin-ideas.md`

- Email-Agent (multiple scoped agents with permission levels)
- Moltbook Agent (scheduled-session, autonomous posting)
- System Monitor Agent (scheduled-session, read-only system health)
- KDE Connect (mobile device integration)

All NOT STARTED. Blocked on scheduled-session and independent agent infrastructure (#7, #8).

**Priority:** Low per plan.

### 16. Personality: Match the User's Energy

**Plan:** `plans/personality-plugin-ideas.md`

Lighter-weight adaptive personality that adjusts persona based on user engagement style.

**Depends on:** Same storage mechanics as Evolving Personality (#11).

### 17. Personality: Persona Marketplace

**Plan:** `plans/personality-plugin-ideas.md`

Browse and install community-authored static personalities. Low priority unless user base grows.

### 18. Personality: Multi-Agent Personality

**Plan:** `plans/personality-plugin-ideas.md`

Multiple distinct personalities with selection rules. Most ambitious personality variant. Blocked on simpler experiments proving out the API.

---

## Overall Progress

**~50% of planned features are implemented.**

The core infrastructure is solid. The biggest gaps are:

- **Agent lifecycle model** — critical for expanding beyond session-linked agents
- **Plugin settings UI** — critical for usability
- **Notification e2e verification** — critical for correctness
