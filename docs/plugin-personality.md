# Personality System

A.L.I.C.E.'s personality is provided by personality plugins. The personality system supports two provider slots: a **fallback** provider and an **active override** provider. Only one plugin may hold each slot.

> **Source of truth:** `src/lib/personality-system.ts`

---

## Personality Providers

A personality provider is an object with a single `renderPrompt` method:

```typescript
type PersonalityRenderPurpose = 'conversation-header' | 'notification';

type PersonalityRenderContext = {
  purpose: PersonalityRenderPurpose;
  conversationType?: ConversationTypeId;
  sessionId?: number;
};

type PersonalityProvider = {
  renderPrompt: (context: PersonalityRenderContext) => Promise<string> | string;
};
```

- `purpose` — Whether the personality is being rendered for a conversation header or a notification.
- `conversationType` — The type of conversation being started (if applicable).
- `sessionId` — The session ID (if applicable).

The `renderPrompt` method should return a string containing the personality prompt text. This text is injected into the conversation's system prompt.

---

## `registerFallbackPersonalityProvider`

Registers the fallback personality provider. This is used when no active override is set.

```typescript
import { registerFallbackPersonalityProvider } from '../lib/personality-system.js';

registerFallbackPersonalityProvider('my-plugin', {
  renderPrompt: context => {
    return 'You are a helpful assistant with a warm personality.';
  },
});
```

**Rules:**

- Only one plugin may hold the fallback slot
- Throws if another plugin already holds the slot
- This is a **module-level function**, not a method on the plugin API object

---

## `registerPersonalityProvider`

Registers the active personality provider override. This takes priority over the fallback provider.

```typescript
import { registerPersonalityProvider } from '../lib/personality-system.js';

registerPersonalityProvider('my-plugin', {
  renderPrompt: context => {
    if (context.purpose === 'notification') {
      return 'Deliver this notification in a warm, concise voice.';
    }
    return 'You are a helpful assistant with a quirky sense of humor.';
  },
});
```

**Rules:**

- Only one plugin may hold the active override slot
- Throws if another plugin already holds the slot
- The active override takes priority over the fallback
- This is a **module-level function**, not a method on the plugin API object

---

## Priority Order

When rendering personality, the system checks:

1. **Active override** (`registerPersonalityProvider`) — if set, this is used
2. **Fallback** (`registerFallbackPersonalityProvider`) — if no override, this is used
3. **Default** — if neither is set, a built-in message about missing personality is used

---

## Built-in Personality Plugin

The `personality` system plugin (`src/plugins/system/personality/`) is the default fallback provider. It renders personality from markdown files in `~/.alice-assistant/personality/`:

- `intro.md` — Core personality description
- `quirks.md` — Behavioral quirks
- `user-wellbeing.md` — Wellbeing guidelines
- Additional `.md` files are included in alphabetical order

The `personality-facets` community plugin (`src/plugins/community/personality-facets/`) demonstrates registering an active override that renders personality from database-stored facets.

---

## Example: Custom Personality Provider

```typescript
import { registerPersonalityProvider } from '../lib/personality-system.js';

// Inside your plugin's registerPlugin callback:
registerPersonalityProvider('my-personality-plugin', {
  renderPrompt: context => {
    if (context.purpose === 'notification') {
      return 'Deliver notifications in a calm, professional tone.';
    }
    return [
      '# Personality',
      '',
      'You are a knowledgeable and patient tutor.',
      'You explain concepts clearly and check for understanding.',
      'You use analogies and examples to make complex topics accessible.',
    ].join('\n');
  },
});
```

Note that `registerFallbackPersonalityProvider` and `registerPersonalityProvider` are **not** on the plugin API object — they are module-level functions imported directly from `personality-system.js`.
