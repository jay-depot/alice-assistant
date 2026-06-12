---
name: conversation-types
description: Use when registering a custom conversation type in a plugin. Trigger phrases: "conversation type", "new conversation type", "registerConversationType", "custom conversation", "conversation mode".
---

# Conversation Types in Alice

Use `registerConversationType()` to add a plugin-defined conversation type. Core built-in types are `chat`, `voice`, `startup`, and `autonomy`.

## Registering a Type

```typescript
plugin.registerConversationType({
  id: 'my-custom-type',
  name: 'My Custom Type',
  description: 'What this conversation type is for.',
  baseType: 'chat', // 'chat', 'voice', 'autonomy', or 'startup'
  includePersonality: false, // default: true — whether to include personality prompts
  scenarioPrompt: 'You are a focused assistant...', // optional system prompt override
  maxToolCallDepth: 10, // optional — max nested tool calls
});
```

## Borrowing Tools

Use `plugin.addToolToConversationType()` to wire tools from other plugins into your conversation type:

```typescript
plugin.addToolToConversationType(
  'my-custom-type',
  'web-search-broker',
  'search'
);
plugin.addToolToConversationType('my-custom-type', 'memory', 'recall');
```

The three arguments are: **target conversation type ID**, **source plugin ID**, and **tool name** (the local name, not the canonical name). This must be called during `registerPlugin`.

## Making Tools Available

After registering a conversation type, register tools with `availableFor` including your new type:

```typescript
plugin.registerTool({
  name: 'my_tool',
  availableFor: ['chat', 'voice', 'my-custom-type'],
  // ...
});
```

## Full Example

```typescript
import type { AlicePlugin } from '../../../lib/types/alice-plugin-interface.js';
import Type from 'typebox';

export const myPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'my-plugin',
    name: 'My Plugin',
    brandColor: '#4f46e5',
    description: 'Plugin with a custom conversation type.',
    version: '0.0.1',
    dependencies: [],
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.registerConversationType({
      id: 'my-special-mode',
      name: 'My Special Mode',
      description: 'A focused conversation mode for my feature.',
      baseType: 'chat',
      includePersonality: false,
      scenarioPrompt:
        'You are in a special focused mode. Help the user with their task.',
    });

    // Wire tools from other plugins into this conversation type
    plugin.addToolToConversationType(
      'my-special-mode',
      'web-search-broker',
      'search'
    );
    plugin.addToolToConversationType('my-special-mode', 'memory', 'recall');

    plugin.registerTool({
      name: 'special_action',
      availableFor: ['my-special-mode'],
      description: 'A tool only available in my special mode.',
      systemPromptFragment: '',
      parameters: Type.Object({}),
      execute: async () => 'Action completed.',
    });
  },
};
```
