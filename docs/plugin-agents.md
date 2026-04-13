# Session-Linked Agents

Session-linked agents are autonomous multi-turn conversations that run alongside a parent chat session. Unlike task assistants, agents run their own iterative loop with synthetic user prompts, making them suitable for long-running research or multi-step autonomous workflows.

> **Source of truth:** `src/lib/agent-system.ts`

---

## Concept

A session-linked agent:

1. Is spawned by a start tool call from the main assistant
2. Runs its own conversation with a configurable number of iterations
3. Between iterations, receives a synthetic "continuation" prompt to keep going
4. Can report progress back to the parent session via `agentReportProgress`
5. Returns a final result via `agentReturnResult`
6. The main assistant receives the result and incorporates it into its response

The key difference from task assistants: agents run **autonomously** in a loop, while task assistants are **single-turn** sub-conversations that the LLM must explicitly complete.

---

## `SessionLinkedAgentDefinition`

```typescript
type SessionLinkedAgentDefinition = {
  /** Unique identifier for this agent type. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The conversation type for the agent's conversation. */
  conversationType: ConversationTypeId;
  /** Optional max number of synthetic user-turn iterations. Defaults to 8. */
  maxIterations?: number;
  /** Synthetic user prompt sent between autonomous agent turns. */
  continuationPrompt?: string;
  /** Synthetic user prompt sent when max iterations are reached. */
  forceReturnPrompt?: string;
  /** The name of the tool that starts this agent. */
  startToolName: string;
  /** Description of the start tool shown to the LLM. */
  startToolDescription: string;
  /** Typebox schema for the start tool's parameters. */
  startToolParameters: TSchema;
  /** Which conversation types the start tool is available in. */
  startToolAvailableFor: ConversationTypeId[];
  /** System prompt fragment for the start tool. */
  startToolSystemPromptFragment: Tool['systemPromptFragment'];
  /** Optional outro for the start tool's result messages. */
  startToolResultPromptOutro?: Tool['toolResultPromptOutro'];
  /** Build the agent's startup context from the start tool's arguments. */
  buildStartup: (args: Record<string, unknown>) => Promise<{
    agentContextPrompt: string;
    kickoffUserMessage: string;
  }>;
  /** Build the final result from the agent's raw output. */
  buildResult: (
    rawResult: SessionLinkedAgentResult,
    startArgs: Record<string, unknown>
  ) => Promise<{
    handbackMessage: string;
    outputText?: string;
    outputArtifacts?: string[];
  }>;
};
```

---

## Registration

Register an agent definition using `registerSessionLinkedAgent`. This returns an `{ autoStartTool }` object containing a pre-built `Tool` that you can add to conversation types:

```typescript
const { autoStartTool } = plugin.registerSessionLinkedAgent({
  id: 'my-agent',
  name: 'My Research Agent',
  conversationType: 'my-agent-conversation',
  maxIterations: 10,
  startToolName: 'startMyAgent',
  startToolDescription: 'Starts an autonomous research session.',
  startToolParameters: Type.Object({
    topic: Type.String({ description: 'The research topic' }),
  }),
  startToolAvailableFor: ['chat'],
  startToolSystemPromptFragment: 'You are an autonomous research agent.',
  buildStartup: async args => ({
    agentContextPrompt: `Research the following topic thoroughly: ${args.topic}`,
    kickoffUserMessage: `Begin researching: ${args.topic}`,
  }),
  buildResult: async (rawResult, startArgs) => ({
    handbackMessage: `Research complete on: ${startArgs.topic}`,
    outputText: rawResult.report,
  }),
});

// Add the auto-start tool to conversation types
plugin.addToolToConversationType('chat', 'my-plugin', autoStartTool.name);
```

---

## Agent Tools

Agents need two special tools available in their conversation type:

### `agentReportProgress`

A built-in tool that agents call to report progress back to the parent session. The progress message appears as a notification in the chat UI.

### `agentReturnResult`

A built-in tool that agents call to return their final result and end the agent loop.

Both tools are registered by the `agents` system plugin and must be added to the agent's conversation type via `addToolToConversationType`.

---

## Lifecycle

```
Main Assistant
  └─ Calls startTool(args)
       └─ Agent begins
            ├─ New Conversation created with agent context
            ├─ buildStartup() called to get context prompt and kickoff message
            ├─ Agent runs autonomous loop:
            │    ├─ LLM responds
            │    ├─ If LLM calls agentReportProgress → progress shown in parent session
            │    ├─ If LLM calls agentReturnResult → agent ends with result
            │    └─ Otherwise → continuationPrompt sent as next user message
            ├─ If maxIterations reached → forceReturnPrompt sent
            └─ Agent returns SessionLinkedAgentResult
                 └─ buildResult() called to produce handback message
```

### Default Prompts

If `continuationPrompt` and `forceReturnPrompt` are not specified, defaults are used:

- **Default continuation prompt:** `"Continue your research. Use your available tools to gather more information. Call agentReportProgress to share any new findings. Call agentReturnResult when you have sufficient coverage to answer the research question."`
- **Default force return prompt:** `"You have reached the maximum number of research iterations. You must call agentReturnResult now with what you have gathered, even if incomplete."`

---

## `SessionLinkedAgentResult`

```typescript
type SessionLinkedAgentResult = {
  summary: string;
  report: string;
};
```

This is the raw result from the agent loop, passed to `buildResult()`.

---

## `SessionLinkedAgentInstance`

```typescript
type SessionLinkedAgentInstance = {
  instanceId: string;
  agentId: string;
  agentName: string;
  linkedSessionId: number;
  status: SessionLinkedAgentStatus; // 'running' | 'cancelled' | 'erroring' | 'completed'
  conversation: Conversation;
  startedAt: Date;
  pendingMessages: PendingAgentMessage[];
  startArgs: Record<string, unknown>;
};
```

---

## Progress Reporting

The `AgentSystem` singleton provides methods for tracking agent progress:

```typescript
import { agentSystem } from '../lib/agent-system.js';

// Subscribe to agent updates
agentSystem.onUpdate(async (update: SessionLinkedAgentUpdate) => {
  console.log(`Agent ${update.agentName}: ${update.kind} - ${update.heading}`);
});

// Get pending messages for a session
const messages = agentSystem.getAndClearPendingMessages(sessionId);

// Cancel agents for a session
agentSystem.cancelBySession(sessionId);
```

### `SessionLinkedAgentUpdate`

```typescript
type SessionLinkedAgentUpdate = {
  linkedSessionId: number;
  agentInstanceId: string;
  agentName: string;
  kind: 'progress' | 'result';
  heading: string;
  content: string;
};
```

---

## Working Example: Deep-Dive Plugin

The `deep-dive` plugin (`src/plugins/community/deep-dive/`) demonstrates a complete session-linked agent:

1. Registers a conversation type: `deep-dive-research` (base type `autonomy`, no personality)
2. Registers a session-linked agent definition with `maxIterations`, `continuationPrompt`, and `forceReturnPrompt`
3. Wires tools into the conversation type: `agentReportProgress`, `agentReturnResult`, `webSearch`, `simpleFetch`, etc.
4. Registers a stylesheet via `webUi.registerStylesheet()`
5. Uses `buildStartup` to construct the research context from the start tool's arguments
6. Uses `buildResult` to format the final research report
