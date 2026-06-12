---
name: system-prompts
description: Use when adding header or footer system prompts to a plugin. Trigger phrases: "system prompt", "header prompt", "footer prompt", "registerHeaderSystemPrompt", "registerFooterSystemPrompt", "DynamicPrompt", "inject prompt".
---

# System Prompts in Alice

Use `registerHeaderSystemPrompt()` and `registerFooterSystemPrompt()` to inject content into the LLM's system prompt. Header prompts appear before conversation turns; footer prompts appear after.

## DynamicPrompt Shape

```typescript
type DynamicPrompt = {
  weight: number; // Lower numbers are sent first. Same weight → sorted alphabetically by name.
  name: string; // Unique name. One word or camelCase — used for log entries and tie-breaking sort.
  getPrompt: (
    context: DynamicPromptContext
  ) => Promise<string | false> | string | false;
};
```

## DynamicPromptContext

```typescript
type DynamicPromptContext = {
  conversationType: string; // e.g. 'chat', 'voice', 'autonomy', 'startup'
  sessionId?: number;
  toolCallsAllowed?: boolean;
  taskAssistantId?: string; // Set when running inside a task assistant
  availableTools?: string[]; // Tool names available for the current conversation type
};
```

## Registering a Prompt

```typescript
plugin.registerHeaderSystemPrompt({
  name: 'myFeaturePrompt',
  weight: 50,
  getPrompt: async context => {
    // Return false to suppress this prompt entirely
    if (context.conversationType === 'startup') {
      return false;
    }
    return '## My Feature\n\nInstructions for the assistant...';
  },
});
```

## Weight Conventions

| Weight range | Typical use                                              |
| ------------ | -------------------------------------------------------- |
| 0–10         | Critical infrastructure (personality, memory)            |
| 20–40        | Important plugin context (skills list, obsidian context) |
| 50–70        | Feature-specific instructions (mood, teach)              |
| 80–100       | Nice-to-have additions, tips                             |

## Suppressing Prompts

Return `false` from `getPrompt()` to skip the prompt for the current context. Common reasons:

- **Startup suppression**: Skip during `startup` conversations (the assistant is just booting)
- **Tool availability**: Skip when certain tools aren't available
- **Conversation type**: Only show for specific types like `voice` or `chat`

## Full Example

```typescript
import type { AlicePlugin } from '../../../lib/types/alice-plugin-interface.js';

export const myPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'my-plugin',
    name: 'My Plugin',
    brandColor: '#4f46e5',
    description: 'Example with system prompts.',
    version: '0.0.1',
    dependencies: [],
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.registerHeaderSystemPrompt({
      name: 'myPluginHeader',
      weight: 50,
      getPrompt: async context => {
        if (context.conversationType === 'startup') {
          return false;
        }
        return '## My Plugin\n\nYou have access to my-plugin tools. Use them wisely.';
      },
    });

    plugin.registerFooterSystemPrompt({
      name: 'myPluginFooter',
      weight: 0,
      getPrompt: async context => {
        if (context.conversationType === 'autonomy') {
          return false;
        }
        return '\n## Current State\n\nThe current state is: active.';
      },
    });
  },
};
```
