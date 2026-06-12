---
name: agents
description: Use when registering a session-linked or independent agent in a plugin. Trigger phrases: "session-linked agent", "independent agent", "registerSessionLinkedAgent", "registerIndependentAgent", "agent dispatch", "autonomous agent", "agent branding", "agent CSS".
---

# Agents in Alice

Alice has two agent types: **session-linked** (dispatched by the assistant during a chat, reports back into the same session) and **independent** (runs on its own schedule, persists across restarts via freeze/thaw).

## When to Use Each

|                   | Session-Linked                                     | Independent                                                    |
| ----------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| **Trigger**       | Assistant calls a start tool during chat           | Plugin starts it on a schedule or external signal              |
| **Lifetime**      | Lives within one chat session                      | Persists across sessions and restarts                          |
| **Reports to**    | The chat session that spawned it                   | Its own REST API + web UI panel                                |
| **Tools**         | `agents.report_progress`, `agents.return_result`   | `agents.sleep`                                                 |
| **State machine** | running → cancelled/erroring/completed             | hatching → running → sleeping → (paused/freezing/frozen/stuck) |
| **Use for**       | Deep research, multi-step tasks the user asked for | Scheduled maintenance, polling, background monitoring          |

## Session-Linked Agents

### Registration

```typescript
const { autoStartTool } = plugin.registerSessionLinkedAgent({
  id: 'my-agent',
  name: 'My Agent',
  conversationType: 'my-agent-conversation',
  maxIterations: 8, // default: 8
  continuationPrompt: 'Keep going...', // synthetic user prompt between turns
  forceReturnPrompt: 'Finish now.', // sent when max iterations reached

  startToolName: 'start',
  startToolAvailableFor: ['chat'],
  startToolDescription: 'Launch my agent when...',
  startToolParameters: Type.Object({
    question: Type.String({ description: 'The question to research.' }),
  }),
  startToolSystemPromptFragment: 'Use my_agent.start when the user asks for...',

  buildStartup: async args => ({
    agentContextPrompt: 'Context for the agent...',
    kickoffUserMessage: 'Please research: ...',
  }),

  buildResult: async (rawResult, startArgs) => ({
    handbackMessage: 'Agent completed.',
    outputText: rawResult.report,
    outputArtifacts: [],
  }),
});

// Register the auto-generated start tool
plugin.registerTool(autoStartTool);
```

`registerSessionLinkedAgent` returns `{ autoStartTool }` — a pre-built `Tool` object you must register with `plugin.registerTool()`.

### Framework Tools

Session-linked agents use two framework tools registered by the `agents` plugin:

- **`agents.report_progress`** — call after each milestone to push an update into the parent chat session
- **`agents.return_result`** — call when done; ends the agent and hands back `summary` + `report`

Wire them into your agent's conversation type:

```typescript
plugin.addToolToConversationType(
  'my-agent-conversation',
  'agents',
  'report_progress'
);
plugin.addToolToConversationType(
  'my-agent-conversation',
  'agents',
  'return_result'
);
```

### Conversation Type

Session-linked agents need a dedicated conversation type (usually `baseType: 'autonomy'`):

```typescript
plugin.registerConversationType({
  id: 'my-agent-conversation',
  name: 'My Agent Session',
  description: 'Autonomous research conversation.',
  baseType: 'autonomy',
  includePersonality: false,
  scenarioPrompt: 'You are an autonomous agent. Do not address the user...',
});
```

## Independent Agents

### Registration

```typescript
const handle = plugin.registerIndependentAgent({
  id: 'my-independent-agent',
  name: 'My Independent Agent',
  description: 'Runs on a schedule to...',
  conversationType: 'my-agent-conversation',

  start: async control => {
    // Called when the agent first hatches
    control.markSleeping('Waiting for first scheduled wake.');
  },

  stop: async () => {
    // Called on shutdown
  },

  onResume: async control => {
    // Called when woken by schedule or supervisor
    control.markRunning('Woken by schedule.');

    void runIndependentAgentLoop({
      conversation,
      agentId: 'my-independent-agent',
      kickoffUserMessage: 'Do your task...',
      onSleep: async reason => {
        plugin.logger.info(`Agent sleeping: ${reason}`);
      },
    });
  },

  freeze: async control => ({
    // Return serializable state for persistence across restarts
    ...serializeConversationState(conversation),
    myCustomState: someValue,
  }),

  thaw: async (frozenState, control) => {
    // Restore from persisted state
    const { conversation: restored, extra } = restoreConversationState(
      frozenState,
      'my-agent-conversation',
      'my-independent-agent'
    );
    conversation = restored;
    someValue = extra.myCustomState as Type;
  },
});
```

`registerIndependentAgent` returns a `RegisteredIndependentAgentHandle` with `start()`, `stop()`, `pause()`, `resume()`, `suspend()`, `freeze()`, `thaw()`, and `getInstance()`.

### The Control Object

The `IndependentAgentControl` passed to lifecycle callbacks provides:

| Method                    | What it does                        |
| ------------------------- | ----------------------------------- |
| `markRunning(msg?)`       | Declare actively working            |
| `markSleeping(msg?)`      | Declare idle, waiting for work      |
| `markPaused(msg?)`        | Declare paused (external signal)    |
| `markForkingToChat(msg?)` | Declare wanting to hand off to chat |
| `reportActivity()`        | Reset the stuck-detection timer     |
| `getInstance()`           | Read current instance snapshot      |

### State Machine

```
hatching → running ⇄ sleeping
                ↓         ↓
              paused    freezing → frozen → thawing → running
                ↓         ↓
              stuck     erroring (terminal)
                ↓
           forkingToChat
```

Core controls transitions to `freezing`/`frozen`/`thawing`/`stuck`/`erroring`. Plugins control `running`/`sleeping`/`paused`/`forkingToChat` via the control object.

### Freeze/Thaw for Persistence

Use `serializeConversationState()` and `restoreConversationState()` from `agent-system.js`:

```typescript
import {
  serializeConversationState,
  restoreConversationState,
} from '../../../lib/agent-system.js';
```

### The Loop Helper

Use `runIndependentAgentLoop()` for the autonomous LLM turn loop:

```typescript
import { runIndependentAgentLoop } from '../../../lib.js';
```

It sends kickoff + continuation prompts, auto-compacts after each iteration, and exits when the agent calls `agents.sleep` or max iterations are reached.

### Framework Tool

Independent agents use **`agents.sleep`** — call it when there's no more work. The agent will be woken later by schedule or supervisor.

## Agent Branding (CSS)

Every session-linked agent and task assistant should ship a `.css` file registered with `web-ui` that gives it a distinct visual identity. This serves two purposes:

1. **Clarifying tool** — users can immediately see which agent produced which messages and tool calls
2. **Alignment assurance** — prevents the assistant from impersonating an agent, since only the real agent's messages get the branded styling

Independent agents, naturally, do not require this, as they do not add any content to the chat UI.

### CSS Class Convention

The web UI applies these classes to agent/task-assistant messages and tool call batches:

| Context                   | CSS Class                                              |
| ------------------------- | ------------------------------------------------------ |
| Agent message bubble      | `.message__bubble.agent--{agent-id}`                   |
| Agent sender label        | `.sender--agent--{agent-id}`                           |
| Agent sender badge        | `.message__sender-badge.agent--{agent-id}`             |
| Agent tool call batch     | `.tool-call-batch.agent--{agent-id}`                   |
| Agent in active panel     | `.active-agents-panel__item.agent--{agent-id}`         |
| Task assistant tool batch | `.tool-call-batch.task-assistant--{task-assistant-id}` |
| Task assistant sender     | `.message__sender.sender--agent--{task-assistant-id}`  |
| Task assistant bubble     | `.message__bubble.agent--{task-assistant-id}`          |

The `{agent-id}` and `{task-assistant-id}` are the kebab-case IDs from the definition (e.g. `deep-dive-research-agent`, `test-task-assistant`).

### Example CSS

```css
/* deep-dive.css — gives the Deep-Dive agent a serif, monochrome look, reminiscent of a newspaper, or printed research report. */

.sender--agent--deep-dive-research-agent,
.message__bubble.agent--deep-dive-research-agent {
  background-color: #aaa;
  color: #222;
  outline: 1px solid #222;
  box-shadow: 0px 0px 10px #aaa;
  font-family: var(--font-serif);
}

.tool-call-batch.agent--deep-dive-research-agent,
.tool-call-batch.agent--deep-dive-research-agent * {
  background-color: #aaa;
  color: #222;
  border-color: #222;
}
```

### Registering the Stylesheet

```typescript
const webUi = plugin.request('web-ui');
if (webUi) {
  webUi.registerStylesheet(path.join(import.meta.dirname, 'my-agent.css'));
}
```

Add `{ id: 'web-ui', version: 'LATEST' }` to `pluginMetadata.dependencies`.

### Design Guidance

- Give each agent a **distinct color palette and font** — users should recognize it at a glance
- Use CSS custom properties (`var(--font-serif)`, `var(--text-primary)`) where possible for theme compatibility
- Style **all** the selectors: message bubbles, sender labels, tool call batches, and the active-agents panel item
- The branding should make it **impossible to confuse** agent output with assistant output
- The default assistant branding is dark, terminal green, with a monospace font, and overall "mainframe hacker" vibe. It is most important that you contrast with _that_. Contrasting with other agents is secondary.
- Be cute about the color scheme and font selection. The test task assistant is "CGA Teal, but tastefully muted," and the deep-dive research agent looks like a printed research report. The branding should evoke the agent's purpose and personality.
- If no distinct "vibe" is obvious from the agent's purpose or personality, ask during the planning stage.
