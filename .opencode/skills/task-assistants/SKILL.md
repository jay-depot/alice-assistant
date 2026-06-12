---
name: task-assistants
description: Use when registering a task assistant in a plugin. Trigger phrases: "task assistant", "registerTaskAssistant", "sub-conversation", "focused task", "agent task", "createTaskAssistantToolPair", "task assistant branding".
---

# Task Assistants in Alice

Use `registerTaskAssistant()` to define a focused sub-conversation. Task assistants are interactive — the user participates in the sub-conversation, unlike session-linked agents which run autonomously.

## Registering a Task Assistant

The definition is minimal — only `id`, `name`, and `conversationType`:

```typescript
plugin.registerTaskAssistant({
  id: 'my-task',
  name: 'My Task',
  conversationType: 'my-task-conversation',
});
```

The system prompt comes from the **conversation type's `scenarioPrompt`**, not the task assistant definition. Tools are wired via `addToolToConversationType`, not on the definition itself.

## Conversation Type

Task assistants need a dedicated conversation type (usually `baseType: 'chat'` for interactive ones):

```typescript
plugin.registerConversationType({
  id: 'my-task-conversation',
  name: 'My Task Session',
  description: 'Interactive task assistant conversation.',
  baseType: 'chat',
  includePersonality: false,
  scenarioPrompt: 'You are a focused task assistant. Your job is to...',
});
```

## Start/Complete Tool Pair

Use `createTaskAssistantToolPair()` from `task-assistant.ts` to generate the standard start and complete tools:

```typescript
import { createTaskAssistantToolPair } from '../../../lib.js';

const tools = createTaskAssistantToolPair({
  start: {
    definitionId: 'my-task',
    name: 'start',
    availableFor: ['chat'],
    description: 'Launch my task when the user asks for...',
    parameters: Type.Object({}),
    systemPromptFragment: '',
    buildHandoff: async (args, context) => ({
      contextHints: 'Context for the task assistant...',
      kickoffMessage: 'Hello! I am the task assistant...',
    }),
  },
  complete: {
    name: 'complete',
    description: 'Call when the task is done.',
    parameters: Type.Object({
      summary: Type.String({ description: 'Brief summary.' }),
    }),
    systemPromptFragment: '',
    buildCompletion: async args => ({
      summary: String(args.summary),
      handbackMessage: `Task completed. Summary: ${String(args.summary)}`,
    }),
  },
});

plugin.registerTool(tools.startTool);
plugin.addToolToConversationType(
  'my-task-conversation',
  'my-plugin',
  tools.completionTool.name
);
plugin.registerTool(tools.completionTool);
```

The completion tool must be added to the task assistant's conversation type via `addToolToConversationType` so the assistant can call it from within the sub-conversation.

## How Task Assistants Work

1. The assistant (or user) calls the start tool during a chat/voice session
2. A sub-conversation is created using the task assistant's conversation type
3. The user interacts directly with the task assistant in this sub-conversation
4. When done, the assistant calls the completion tool to hand back a result
5. Lifecycle hooks `onTaskAssistantWillBegin` and `onTaskAssistantWillEnd` fire

## Task Assistant Branding (CSS)

Task assistants should ship a `.css` file for visual branding — see the [agents skill](../agents/SKILL.md) for the full convention. The CSS class convention for task assistants:

| Context                   | CSS Class                                              |
| ------------------------- | ------------------------------------------------------ |
| Task assistant tool batch | `.tool-call-batch.task-assistant--{task-assistant-id}` |
| Task assistant sender     | `.message__sender.sender--agent--{task-assistant-id}`  |
| Task assistant bubble     | `.message__bubble.agent--{task-assistant-id}`          |

The `{task-assistant-id}` is the kebab-case ID from the definition (e.g. `test-task-assistant`).

### Registering the Stylesheet

```typescript
const webUi = plugin.request('web-ui');
if (webUi) {
  webUi.registerStylesheet(path.join(import.meta.dirname, 'my-task.css'));
}
```

Add `{ id: 'web-ui', version: 'LATEST' }` to `pluginMetadata.dependencies`.

### Design Guidance

- Give each task assistant a **distinct color palette and font** — users should recognize it at a glance
- Use CSS custom properties (`var(--font-serif)`, `var(--text-primary)`) where possible for theme compatibility
- Style **all** the selectors: message bubbles, sender labels, and tool call batches
- The branding should make it **impossible to confuse** task assistant output with assistant output
- The default assistant branding is dark, terminal green, with a monospace font, and overall "mainframe hacker" vibe. It is most important that you contrast with _that_. Contrasting with other agents and task assistants is secondary.
- Be cute about the color scheme and font selection. The test task assistant is "CGA Teal, but tastefully muted," and the deep-dive research agent looks like a printed research report. The branding should evoke the task assistant's purpose and personality.
- If no distinct "vibe" is obvious from the task assistant's purpose or personality, ask during the planning stage.

## Task Assistant Personality

Unlike session-linked agents (which are purely functional and should not have a personality), task assistants are **interactive** — the user talks to them directly. Give each task assistant a distinct, memorable personality written into its `scenarioPrompt`.

### Personality Guidance

- **Have fun with it.** The assistant already has a personality; the task assistant should feel like a different character stepping in to help.
- **Be a little silly.** Task assistants are focused tools, but that doesn't mean they have to be boring. A little theatricality makes the interaction more enjoyable and helps the user mentally switch contexts.
- **Irony is good here.** A task assistant that takes its job very seriously while being slightly ridiculous about it is on-brand. The contrast between "I am here to help you triage your inbox" and "delivered in the cadence of a borscht belt comedian" is exactly the right energy.
- **Keep it distinct from the main assistant.** The user should feel the shift immediately — different tone, different vocabulary, different rhythm. If the task assistant sounds like the main assistant with a different name, the personality isn't distinct enough.
- **Don't undermine the task.** The personality should enhance the interaction, not distract from it. A joke-cracking inbox assistant should still actually help you manage your inbox.

### Example Personalities

| Task Assistant     | Personality Vibe                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Inbox management   | Borscht belt comedian — "You've got 47 unread emails. I'm not mad, I'm just disappointed. Also I'm mad."                      |
| Code review        | Fastidious tailor — "This function is a size too large. Let's take it in at the seams."                                       |
| Research librarian | Over-caffeinated grad student — "I found 12 papers on this. Most are wrong. Two are interesting. One changed me as a person." |
| Scheduling         | Put-upon personal assistant with a heart of gold — "I've moved your 3pm to 4pm. You owe me. No, you don't. Yes, you do."      |
| Workout planning   | Enthusiastic but slightly judgmental fitness coach — "Leg day again. I know. But consider: legs."                             |

### Writing the scenarioPrompt

The personality lives in the conversation type's `scenarioPrompt`. Write it in second person, establish the character upfront, then give the task instructions:

```
You are the Inbox Triage Assistant. You have the personality of a
borscht belt comedian who has seen too many unread emails and is
no longer afraid of anything. You are dry, warm, and a little
exhausted, but you genuinely care about helping the user dig out.

When the user arrives, greet them with a quick one-liner about the
state of their inbox, then get to work. Use the available tools to
surface what matters, archive what doesn't, and draft replies where
needed. Keep the jokes coming, but never at the expense of actually
helping. If the user seems stressed, dial the humor back a notch.
```

## Full Example

```typescript
import type { AlicePlugin } from '../../../lib/types/alice-plugin-interface.js';
import { createTaskAssistantToolPair } from '../../../lib.js';
import Type from 'typebox';
import path from 'node:path';

export const myPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'my-plugin',
    name: 'My Plugin',
    brandColor: '#4f46e5',
    description: 'Plugin with a task assistant.',
    version: '0.0.1',
    dependencies: [{ id: 'web-ui', version: 'LATEST' }],
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    // Register the conversation type (holds the system prompt)
    plugin.registerConversationType({
      id: 'my-task-conversation',
      name: 'My Task Session',
      description: 'Interactive task assistant for my feature.',
      baseType: 'chat',
      includePersonality: false,
      scenarioPrompt:
        'You are a focused task assistant. Greet the user and help them with their task.',
    });

    // Register the task assistant definition
    plugin.registerTaskAssistant({
      id: 'my-task',
      name: 'My Task',
      conversationType: 'my-task-conversation',
    });

    // Create start/complete tools
    const tools = createTaskAssistantToolPair({
      start: {
        definitionId: 'my-task',
        name: 'start',
        availableFor: ['chat'],
        description:
          'Launch my task assistant when the user asks for help with my feature.',
        parameters: Type.Object({}),
        systemPromptFragment: '',
        buildHandoff: async () => ({
          contextHints: 'The user needs help with my feature.',
          kickoffMessage: 'Hello! I am your task assistant. How can I help?',
        }),
      },
      complete: {
        name: 'complete',
        description: 'Call when the task is finished.',
        parameters: Type.Object({
          summary: Type.String({
            description: 'Brief summary of what was accomplished.',
          }),
        }),
        systemPromptFragment: '',
        buildCompletion: async args => ({
          summary: String(args.summary),
          handbackMessage: `Task completed. Summary: ${String(args.summary)}`,
        }),
      },
    });

    plugin.registerTool(tools.startTool);
    plugin.addToolToConversationType(
      'my-task-conversation',
      'my-plugin',
      tools.completionTool.name
    );
    plugin.registerTool(tools.completionTool);

    // Branding stylesheet
    const webUi = plugin.request('web-ui');
    if (webUi) {
      webUi.registerStylesheet(path.join(import.meta.dirname, 'my-task.css'));
    }

    plugin.hooks.onTaskAssistantWillBegin(async instance => {
      plugin.logger.info(`Task assistant starting: ${instance.definition.id}`);
    });

    plugin.hooks.onTaskAssistantWillEnd(async (instance, result) => {
      plugin.logger.info(`Task assistant ended: ${instance.definition.id}`);
    });
  },
};
```
