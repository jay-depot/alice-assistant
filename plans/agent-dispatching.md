# ALICE Assistant Agent Dispatching

## Overview

Agents are useful, but they are also an easy way to accidentally create systems that are difficult to understand, difficult to supervise, and harder than necessary to keep safe. This document lays out the design philosophy for agent support in ALICE and narrows the architectural questions that still need answers before implementation.

The goal is not to make ALICE as "agentic" as possible. The goal is to add agent support in a way that remains understandable to plugin authors and controllable by end users.

## Definitions

### Agents are not transports

This is a settled architectural decision.

An agent is a runtime worker that performs a bounded task with a bounded set of tools and a defined lifecycle.

A transport is a communication medium through which assistant sessions are conducted or surfaced. Chat is the current primary transport. Voice and any future plugin-provided media such as email, SMS, or Telegram should be modeled as transports, not as agents.

Agents may use transports, report into transports, or hand off work into assistant sessions conducted through transports. They are not themselves the transport abstraction.

### Sessions and handoffs

An assistant session is an interactive conversation context with the user.

A handoff is the act of transferring context gathered by an agent into an assistant session so the assistant can continue interactively with the user.

## Agent Types

We will generally categorize agents into three types based on their lifecycle and relationship to assistant sessions.

1. Session-linked agents
   These agents are created from an assistant session, usually by a tool call in response to a user request. They should be narrowly scoped, task-oriented, and designed to report back into the session that created them. If the linked session ends, the agent should be cancelled.

2. Scheduled-session agents
   These agents are created by plugins, usually on a schedule or in response to an event. Their job is to wake up, gather context, and decide whether an interactive handoff is needed. They should not be treated as free-ranging background workers.

3. Independent agents
   These agents are not expected to interact with an assistant session as part of their normal operation. They may still create or request a handoff when needed, but they are designed to keep functioning outside of any one user conversation.

## Core Philosophy

### Most agents should be session-linked

Session-linked agents are the safest and easiest model to reason about. They have a clear originating context, a clear owner, a clear cancellation condition, and a clear place to report results.

When a plugin author is unsure which model to use, the default answer should be session-linked.

### Scheduled-session agents should not perform destructive actions directly

Scheduled-session agents should not be given destructive tools. If they determine that a destructive action might be appropriate, they should hand off into an assistant session and let the user review the gathered context before approving anything.

This keeps the user in control and prevents scheduled work from silently crossing the line into unsupervised action.

### Independent agents should be rare in an assistant-focused system

ALICE is primarily an assistant. Most useful agent behavior in that context fits better into the session-linked model.

Independent agents should be reserved for cases where a plugin is deliberately extending ALICE beyond ordinary assistant behavior and the design still makes operational sense without a continuously attached conversation.

### Every agent should have the minimum tools required for its task

Do not give agents open-ended execution surfaces when a narrower interface will do.

Do not hand an agent a raw shell if a specific capability can be exposed as a constrained tool instead.

Do not allow agents to read sensitive files unless the tool is explicitly designed for that purpose, and if such a tool is unavoidable, redact secrets in code before returning results. An agent cannot leak secrets it cannot read.

### Reuse existing capabilities where possible

When defining an agent context, prefer reusing existing tool definitions and plugin capabilities over inventing one-off replacements.

If scratch files, memory recall, web access, or other features already exist elsewhere in the system, the agent model should make it easy to reuse them safely instead of encouraging duplicate implementations.

## V1 Scope

The recommended first implementation scope is:

1. Chat-first session-linked agents.
2. Narrowly scoped scheduled-session agents that can gather context and initiate a handoff.
3. No direct destructive actions by scheduled-session agents.
4. No voice-linked agents in v1.
5. No generalized transport integration model in v1 beyond what is needed to keep the transport boundary conceptually clean.

This scope keeps the initial implementation aligned with the strongest existing architectural model in the codebase: persistent chat sessions and plugin-managed background work.

## Hard Invariants For V1

These are the constraints the implementation should assume unless this document is revised:

1. Transports are not agents.
2. Session-linked agents do not outlive their linked session.
3. Scheduled-session agents do not perform destructive actions directly.
4. Agent tool access is explicit and minimal.
5. Plugins must not be allowed to register undeclared agents at runtime.

## Open Questions And Current Answers

These are the architectural questions and decisions accumulated so far after committing to the transport decision.

### 1. Agent identity and lifecycle

We need to define what an agent instance is in runtime terms.

Current answers so far:

1. Session-linked agents are identified by agent ID plus session ID and are created by assistant tool calls.
2. Scheduled-session agents are identified by agent ID plus schedule ID and are created by plugin code.
3. Independent agents are identified by agent ID and are created by plugin code.
4. Persistence and lifecycle expectations differ by agent type and should be treated as part of the runtime contract, not as incidental implementation details.

| Agent Type         | Identified By            | Created by                                | Persistent State                              | Lifecycle States         |
| ------------------ | ------------------------ | ----------------------------------------- | --------------------------------------------- | ------------------------ |
| Session-linked     | Agent ID + Session ID    | Assistant makes                           | Saves state to database, lives across         | Running, Needs Input     |
|                    | tool call                | restarts until task completion,           | Cancelled, Erroring                           |
|                    |                          | cancellation, or linked chat              | Stuck, Completed                              |
|                    |                          | session closure                           |
| ------------------ | ------------------------ | -----------------                         | --------------------------------------------- | -----------------        |
| Scheduled-session  | Agent ID + Schedule ID   | Plugin code                               | Outstanding tasks are given some time to      | Running, Handoff Pending |
|                    |                          | complete at shutdown. No provisions to    | Cancelled, Erroring,                          |
|                    |                          | resume built in.                          | Stuck, Completed                              |
|                    |                          |                                           |
| ------------------ | ------------------------ | -----------------                         | --------------------------------------------- | -----------------        |
| Independent        | Agent ID                 | Plugin code                               | Core provides a single, long-running          | Hatching, Running,       |
|                    |                          | context that persists across restarts. No | Freezing, Thawing,                            |
|                    |                          | built-in expiration or cancellation       | Erroring, Stuck,                              |
|                    |                          | condition. Plugin must manage lifecycle   | Paused, Sleeping                              |
|                    |                          | explicitly.                               | Forking to Chat                               |

**Lifecycle state definitions:**

- Hatching: The independent agent is starting for the first time, and has not indicated that it is fully operational yet. It may be doing setup work, gathering initial context, or trying to inform the user of settings that need to be configured before it can run properly.
- Running: The agent is fully operational and performing its task.
- Needs Input: The session-linked agent is waiting for the assistant to solicit user input on its behalf before it can continue.
- Handoff Pending: The scheduled-session agent has asked to hand-off its context into a new assistant session, and is now waiting for that session to be created and the handoff to complete before it can continue.
- Freezing: The independent agent is in the process of preserving its state before shutting down so it can be restored at the next start-up.
- Thawing: The independent agent is in the process of restoring its state and picking up where it left off at the last shutdown.
- Cancelled: The agent has been cancelled by an external actor and should stop as soon as possible.
- Completed: The agent has completed its task and will stop soon.
- Stuck: The agent is still running but has not generated any output or made any tool calls, nor has it indicated that it is waiting for input, for some time threshold. Most of the time this means the LLM got stuck, and just needs a quick "are you there?" message to get it going again, but it could also indicate a more serious problem that needs investigation.
- Erroring: Something threw an error during the agent's operation. The agent should be stopping at this point.
- Sleeping: The independent agent has indicated that it is intentionally idle due to having no work to perform, but it is still alive and waiting for new work to wake it up again.
- Paused: The independent agent has been paused by the user, and will perform no actions or LLM transactions until explicitly resumed.
- Forking to Chat: The independent agent has requested a fork. This means its context is going to be duplicated. One copy will continue to be the long-running independent agent, and the other copy will be handed off to become an assistant in a chat session. When the fork is complete, the independent agent will transition back to Running, and the assistant session will open in the chat (Or other transport, as that functionality is added)

Remaining questions:

1. Which of these lifecycle states are core concepts versus optional states exposed only by certain agent types?
2. Which state transitions are controlled by core, and which are declared by the agent runtime itself?
3. How much of this lifecycle model must be reflected in persistent storage versus only in memory?

### 2. Session binding for session-linked agents

We need to define exactly how a session-linked agent relates to an assistant session.

Current answers so far:

1. One session can host multiple simultaneous session-linked agents.
2. A session-linked agent is tied to a single session by definition and cannot span multiple sessions.
3. When a linked session closes, the plugins defining its associated session-linked agents should be notified, likely through an event-emitter-style mechanism, that the session is closing and the agent is about to be cancelled. The plugin gets a brief chance to do quick cleanup work, and then core cancels the agentic loop so the agent cannot do anything further.
4. If a session-linked agent is in the middle of a tool call when its linked session closes, that tool call will be interrupted and will not complete. Plugins should be prepared for that in any long-running tool calls used by session-linked agents.
5. Whatever output that exists to show progress the agent was able to make before cancellation should be summarized and added to the linked session's history, so it can be included in the summary that lands in the assistant's memory.
6. Cancellation should happen before final session summarization so the agent cannot generate any new output during the summarization process.

Remaining questions:

1. What concrete notification mechanism should core use to tell plugins that linked session closure is imminent? Answer: This gets into registration API shape, but what I'm thinking is that registering a session-linked agent definition should return an object that consists of the event emitter for that agent's lifecycle events (specifically, a `start` event, which then receives an emitter for that instance's `finish`, `cancel` and `error` events to its callback) and an automatically generated tool definition the owning plugin should immediately register. That tool is what the assistant uses to create new agents of that type, and the event emitter is how the plugin subscribes to lifecycle events for those agents.
2. How much time, if any, should plugins get for cleanup before core forcefully cancels the loop?
3. What guarantees should core make about partially completed tool calls during cancellation? Tentative Answer: We should allow them to return (up to a reasonable timeout) and we can pass their results into the agent LLM as a final request before shutting down the agent. In this request, the agent shouldn't be given any tool access anymore, and it should be informed that it is shutting down and to report whatever progress it can directly into a chat response so it can be summarized and passed back into the chat history for the assistant's memory. This allows the agent to report any progress it made before cancellation, but prevents it from trying to continue working.

### 3. Context inheritance and return path

We need to define how an agent receives context and how it communicates results back.

Current answers so far:

1. A new session-linked agent receives a task-specific system prompt supplied by the plugin that provides the agent, the usual tools prompt, and a user message containing the task the assistant is asking the agent to perform.
2. An agent asks the assistant to get clarification from the user through a framework-provided tool call. The assistant turns that request into user-facing dialogue, and the eventual user response is sent back to the agent through a corresponding framework-provided tool.
3. An agent reports progress by making a framework-provided tool call that sends progress updates to core for UI surfacing and assistant awareness.
4. Final results are returned by a framework-provided tool call that sends a final result message to core. That message becomes part of the linked session's history, and the full agent session is also summarized and stored so the assistant can reference it later.
5. Agents are not restricted to defined checkpoints for sending information back. They can send messages whenever needed through tool calls, and core should queue those messages if surfacing them immediately would interfere with assistant tool-call chains.

6. The framework tools `reportProgress`, `returnResult`, and `askUser` should always be available to every session-linked agent.
7. Core should represent queued progress updates and final results as system messages. Progress updates should use the heading "Progress Update from [Agent Name]", final results should use the heading "Final Result from [Agent Name]", and the agent's final summary should use the heading "Summary of [Agent Name] Session".
8. Completed agent sessions should be summarized by a clean LLM session that only sees the agent's output messages and tool calls, without the initial task description or the tool-related portions of the system prompt.

Remaining questions:

1. How should the clean summarization path be implemented so it stays faithful without pulling in irrelevant prompt context? Answer: There is a patttern for this in the current conversation summarization code we can base this on.
2. Should any agent-to-session messages be hidden from the assistant-facing history while still appearing in the UI?

### 4. Tool boundaries and conversation-type strategy

We need to decide how agent execution contexts relate to the existing conversation and tool model.

Current answers so far:

1. Agents may reuse the existing autonomy conversation type, which is restricted to read-only tools and tools that modify internal assistant state (and is therefore a "safe" set of tools), when its default tool set and prompt behavior, are sufficient, and the assistant's personality being included won't cause problems. Otherwise, plugins may register custom conversation types for agent use.
2. Tool access is determined by the conversation type the agent runs under.
3. A tool should generally be considered unsafe for agent use if it can delete or overwrite user data or communicate publicly in the user's name without an approval path. The preferred pattern is for the agent to gather context and then hand off into an assistant session for user review and approval.
4. Tools are considered "safe" for agent use if they are read-only AND include guardrails to prevent accidentally leaking sensitive data; or if they only modify internal assistant state and data, such as scratch files or proficiencies.
5. Unsafe plugin authors cannot be fully prevented in a Node environment, so the design goal should be to make the official path easy, well-documented, and metadata-enforced enough that safe behavior is the default path for normal plugin development.

6. Conversation type will be the authoritative source for tool access. Agent metadata will specify the conversation type an agent runs in, and most plugins that provide agents are expected to also provide a custom conversation type tailored to that task.
7. Core does not need a separate first-class notion of agent-safe tools if conversation-type scoping remains the sole authoritative source for tool access.
8. Confirmation-dialog patterns that bypass a handoff should not be prohibited outright. Instead, core should provide an official path for quick user confirmations so plugin authors do not invent inconsistent ad hoc versions.

Remaining questions:

1. What should the official quick-confirmation path look like at the API level?
2. Should conversation types be allowed to expose both full handoff and quick-confirmation patterns at the same time? Answer: This is worth discouraging in documentation, and examples, but I'm not sure it's worth the effort to enforce. Also there are probably a small number of legitimate cases where an agent type might need access to both patterns, though hopefully not in the same session.

### 5. Metadata and registration rules

We need a plugin-facing declaration model that core can enforce.

Current answers so far:

1. At minimum, plugins must declare the agent name, agent type, and the conversation type the agent runs under.
2. Capability class and trigger model should also be declared if core can actually enforce them.
3. Risk level should probably not be treated as authoritative metadata because plugin authors are not reliable judges of their own risk profile.
4. Core should enforce that session-linked agents are only created by tool calls from the linked session, and that scheduled-session and independent agents are only created by plugin code.
5. Core APIs for launching agents should ensure the agent starts with the correct conversation type.
6. Metadata should be operational wherever possible, with perhaps only a human-readable description being purely presentational.

Remaining questions:

1. Beyond the minimum fields, what additional metadata is worth declaring if it cannot be strongly enforced?
2. What precise metadata shape should core require at registration time?
3. Which capability and trigger declarations are realistically enforceable in the first implementation?

### 6. Runtime supervision and shutdown

We need predictable rules for stopping agents and surfacing failures.

Current answers so far:

1. Prefer not to introduce agent-scoped lifecycle hooks. If a plugin wants to let other plugins alter agent behavior, the cleaner pattern is for the plugin providing the agent to explicitly `offer` a supported API for that behavior.
2. Agent-scoped lifecycle hooks should only be introduced if a real problem emerges that cannot be solved more cleanly some other way.

Remaining questions:

1. What supervision API does core expose for stopping or cancelling agents?
2. What cleanup guarantees exist when an agent is cancelled?
3. How are failures surfaced to users, plugin authors, and logs?

### 7. UI implications

UI should follow the runtime contract, not define it, but there are still implementation-facing questions to answer later.

Current answers so far:

1. The UI should warn before closing a session that still has active linked agents, even if the UX is slightly imperfect.

Remaining questions:

1. How should session-linked agents appear in a chat session while running?
2. What should an agent management dashboard show for scheduled-session and independent agents?
3. How should the UI communicate agent capabilities and safety posture to users without relying on self-declared risk levels?

### 8. Future transport integration

Transports are not part of the agent model, but this decision does create a future integration boundary that should be acknowledged.

Current answers so far:

1. During handoff, the agent is effectively transformed into an assistant session, and transport handling becomes core's problem rather than the agent's. The agent only needs a way to request the handoff.
2. Core should be responsible for creating the assistant session, populating it with the agent's context, and surfacing it through the appropriate transport.

Remaining questions:

1. What transport abstraction should eventually exist for chat, voice, and plugin-provided channels?
2. What, if anything, must be designed now so that future transports can integrate cleanly later?

## Implementation Implications

Several practical consequences already follow from the decisions above.

1. The Web UI will need a way to represent active session-linked agents within a chat session and a separate place to supervise scheduled-session and independent agents.
2. Agent registration should be metadata-backed and enforced by core.
3. Logging needs to become structured enough to handle multiple concurrent agent lifecycles without devolving into unreadable console output.
4. The agent creation API must be simple enough that plugin authors are not tempted to route around it.
5. Voice support should be treated as future transport work, not as a blocker for the first implementation.

## Recommended Next Step

The next design pass should focus on the sections that are still materially unresolved:

1. Runtime supervision and shutdown.
2. Metadata and registration rules.
3. UI implications.
4. Deciding which parts of the identity, session-binding, context, tool-boundary, and transport sections are now settled enough to be rewritten as explicit requirements instead of provisional answers.

Until those are resolved, the UI and transport sections should remain downstream concerns rather than design drivers.
