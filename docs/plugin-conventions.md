# Plugin Coding Conventions

This document covers the coding conventions specific to A.L.I.C.E. plugins. For general project conventions, see `.github/copilot-instructions.md`.

---

## File and Identifier Naming

| Context                      | Style                         | Example                                           |
| ---------------------------- | ----------------------------- | ------------------------------------------------- |
| Source files                 | kebab-case                    | `web-search-broker.ts`                            |
| Classes / types / interfaces | PascalCase                    | `AlicePluginInterface`, `TaskAssistantDefinition` |
| Variables / functions        | camelCase                     | `loadPlugins`, `currentMood`                      |
| Plugin IDs                   | kebab-case                    | `web-ui`, `notifications-broker`                  |
| DB entity class names        | PascalCase with plugin prefix | `MoodEntry`, `ReminderItem`                       |
| Config files                 | kebab-case matching plugin ID | `my-plugin.json`                                  |

---

## Imports

- Use ESM imports with explicit `.js` extensions for local imports
- Use `node:` prefixes for Node.js built-ins
- Use `import type` for type-only imports

```typescript
// Local imports — always include .js extension
import { AlicePlugin } from '../../../lib.js';
import type { Tool } from '../tool-system.js';

// Node built-ins — always use node: prefix
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Type-only imports
import type { ConversationTypeDefinition } from '../conversation-types.js';
```

---

## Typebox Schemas

Use Typebox schemas for plugin configuration and tool parameters:

```typescript
import { Type } from 'typebox';

// Tool parameters
const MyToolParameters = Type.Object({
  query: Type.String({ description: 'The search query' }),
  maxResults: Type.Optional(Type.Number({ default: 10, minimum: 1 })),
});

// Plugin configuration
const MyPluginConfig = Type.Object({
  enabled: Type.Boolean({ default: true }),
  maxRetries: Type.Number({ default: 3, minimum: 0 }),
  endpoint: Type.String({ default: 'https://api.example.com' }),
});
```

---

## Error Handling

Prefer explicit, user-actionable errors that name the offending plugin and describe how to recover:

```typescript
// Good — names the plugin, describes the problem, suggests a fix
throw new Error(
  `my-plugin: Failed to connect to the API at ${endpoint}. ` +
    `Check your network connection or disable my-plugin in enabled-plugins.json.`
);

// Bad — vague, no recovery path
throw new Error('Connection failed');
```

Light snark poking fun at misbehaving plugins is on-brand:

```typescript
throw new Error(
  `my-plugin: The location-broker plugin seems to be having an existential crisis ` +
    `and can't figure out where it is. Try restarting, or disable my-plugin if the ` +
    `situation doesn't improve.`
);
```

---

## Plugin Structure

A typical plugin directory:

```
src/plugins/community/my-plugin/
  my-plugin.ts          # Main plugin file (default export)
  my-plugin.test.ts     # Tests (Vitest)
  my-plugin-web-ui.tsx  # Optional web UI client bundle
  my-plugin-web-ui.css  # Optional web UI styles
```

For plugins with more complex logic, split into sub-modules:

```
src/plugins/system/memory/
  memory.ts             # Main plugin file
  memory-entities.ts    # MikroORM entity definitions
  memory-helpers.ts     # Helper functions
  memory.test.ts        # Tests
```

---

## Module Augmentation for `offer()`

Always declare the `PluginCapabilities` augmentation in the main plugin file, using a relative path to `lib.js`:

```typescript
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'my-plugin': {
      myMethod: (arg: string) => Promise<string>;
    };
  }
}
```

For system plugins in `src/plugins/system/`, the relative path is `../../../lib.js`.
For community plugins in `src/plugins/community/`, the relative path is `../../../lib.js`.
For user plugins in `~/.alice-assistant/user-plugins/`, use the appropriate path.

---

## Testing

- Use Vitest for all tests
- Test files go alongside the source file: `my-plugin.ts` → `my-plugin.test.ts`
- Test file pattern: `src/**/*.test.ts`
- The eslint directive `@typescript-eslint/no-explicit-any` is only allowed as a line comment, and only in tests
- Never use `any` in production code

```typescript
import { describe, it, expect } from 'vitest';

describe('my-plugin', () => {
  it('should do something', () => {
    expect(true).toBe(true);
  });
});
```

---

## Configuration Files

- Main config: `~/.alice-assistant/alice.json`
- Plugin config: `~/.alice-assistant/plugin-settings/<plugin-id>/<plugin-id>.json`
- Plugin enablement: `~/.alice-assistant/plugin-settings/enabled-plugins.json`
- Legacy tool config: `~/.alice-assistant/tool-settings/`

---

## Personality Files

Personality content is scaffolded into `~/.alice-assistant/personality/`. The default set includes:

- `intro.md` — Core personality description
- `quirks.md` — Behavioral quirks
- `user-wellbeing.md` — Wellbeing guidelines

Additional `.md` files are included in alphabetical order.
