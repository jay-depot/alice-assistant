# Plugin Development Guide

A step-by-step guide to building plugins for A.L.I.C.E. Assistant.

---

## Quick Start

A minimal plugin consists of a single file exporting an `AlicePlugin` object:

```typescript
// src/plugins/community/my-plugin/my-plugin.ts
import { AlicePlugin } from '../../../lib.js';

const myPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'my-plugin',
    name: 'My Plugin',
    version: '1.0.0',
    description: 'A minimal example plugin.',
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    // Register tools, prompts, hooks, etc. here
  },
};

export default myPlugin;
```

---

## Plugin Metadata

```typescript
type AlicePluginMetadata = {
  id: string; // Unique identifier, conventionally kebab-case
  name: string; // Human-friendly name
  version: string; // Semver. Built-in plugins may use "LATEST"
  description: string; // Short description
  required?: boolean; // Only set by the built-in registry
  builtInCategory?: 'system' | 'community'; // Only set by the built-in registry
  dependencies?: AlicePluginDependency[]; // Plugins that must load first
};
```

**Important rules for user plugins:**

- `version` must be a real semver string — you **cannot** use `"LATEST"`
- `required` must not be set — only the built-in registry assigns this
- `builtInCategory` must not be set — only the built-in registry assigns this

---

## Built-in vs. User Plugins

|                       | Built-in plugins                                | User plugins                       |
| --------------------- | ----------------------------------------------- | ---------------------------------- |
| **Location**          | `src/plugins/system/`, `src/plugins/community/` | `~/.alice-assistant/user-plugins/` |
| **Registry**          | `src/plugins/system-plugins.json`               | none                               |
| **Can be `required`** | Yes                                             | No                                 |
| **Can use `LATEST`**  | Yes                                             | No                                 |
| **Category**          | `system` or `community`                         | not built-in                       |

---

## Enablement

Plugins are enabled or disabled in `~/.alice-assistant/plugin-settings/enabled-plugins.json`:

```json
{
  "datetime": true,
  "system-info": true,
  "my-plugin": true
}
```

Required built-in plugins cannot be disabled.

---

## Configuration

Use `plugin.config()` to create a typed configuration file for your plugin:

```typescript
import { Type } from 'typebox';

const config = await plugin.config(
  Type.Object({
    maxRetries: Type.Number({ default: 3 }),
    apiEndpoint: Type.String({ default: 'https://api.example.com' }),
    enabled: Type.Boolean({ default: true }),
  }),
  {
    maxRetries: 3,
    apiEndpoint: 'https://api.example.com',
    enabled: true,
  }
);

// Later, in tool execution or hooks:
const settings = config.getPluginConfig();
console.log(settings.maxRetries); // number

// Access system-wide config:
const systemConfig = config.getSystemConfig();
console.log(systemConfig.configDirectory); // string
```

Config files are stored at `~/.alice-assistant/plugin-settings/<plugin-id>/<plugin-id>.json`.

---

## Dependencies

Declare dependencies in your plugin metadata:

```typescript
const myPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'my-plugin',
    name: 'My Plugin',
    version: '1.0.0',
    description: 'A plugin that depends on memory and web-ui.',
    dependencies: [
      { id: 'memory', version: 'LATEST' },
      { id: 'web-ui', version: 'LATEST' },
    ],
  },
  // ...
};
```

The engine ensures dependencies are loaded before your plugin. If a dependency is missing, the assistant won't start.

### Using a Dependency's API

```typescript
async registerPlugin(pluginInterface) {
  const plugin = await pluginInterface.registerPlugin();

  const memory = plugin.request('memory');
  if (memory) {
    await memory.saveMemory('Hello from my plugin!');
  }
},
```

`request()` returns `undefined` if the dependency doesn't offer an API. Always check for `undefined`.

### Offering an API

```typescript
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'my-plugin': {
      doSomething: (arg: string) => Promise<string>;
    };
  }
}

// Inside registerPlugin:
plugin.offer<'my-plugin'>({
  doSomething: async (arg: string) => {
    return `Processed: ${arg}`;
  },
});
```

See [Offered APIs Reference](./plugin-offered-apis.md) for all system plugin APIs.

---

## Registering Tools

```typescript
import { Type } from 'typebox';

plugin.registerTool({
  name: 'myTool',
  availableFor: ['chat', 'voice'],
  description: 'Does something useful.',
  parameters: Type.Object({
    input: Type.String({ description: 'The input to process' }),
  }),
  systemPromptFragment:
    'You have access to myTool, which does something useful.',
  toolResultPromptIntro: 'Tool result:',
  toolResultPromptOutro: '',
  execute: async (args, context) => {
    const { input } = args as { input: string };
    return `Processed: ${input}`;
  },
});
```

See [Plugin API Reference](./plugin-api.md#registertooltooldefinition) for the full `Tool` type.

---

## Registering System Prompts

```typescript
// Header prompt (appears before conversation turns)
plugin.registerHeaderSystemPrompt({
  name: 'myPluginHeader',
  weight: 100,
  getPrompt: context => {
    if (context.conversationType === 'voice') {
      return false; // Exclude from voice conversations
    }
    return 'Additional context for the assistant...';
  },
});

// Footer prompt (appears after conversation turns)
plugin.registerFooterSystemPrompt({
  name: 'myPluginFooter',
  weight: 500,
  getPrompt: context => {
    return 'Reminder: always be helpful.';
  },
});
```

**Weight limits:** Non-built-in plugins must use weights in the range 0–9999. Lower weights appear first. Same-weight prompts are sorted alphabetically by name.

---

## Using Hooks

```typescript
async registerPlugin(pluginInterface) {
  const plugin = await pluginInterface.registerPlugin();

  // Lifecycle hooks
  plugin.hooks.onAllPluginsLoaded(async () => {
    console.log('All plugins loaded!');
  });

  plugin.hooks.onAssistantAcceptsRequests(async () => {
    console.log('Assistant is live!');
  });

  // Event hooks
  plugin.hooks.onUserConversationWillBegin(async (conversation, type) => {
    console.log(`Conversation started: ${type}`);
  });
},
```

See [Plugin Hooks Reference](./plugin-hooks.md) for all available hooks and their registration windows.

---

## Error Handling

Prefer explicit, user-actionable errors that name the offending plugin and describe how to recover:

```typescript
// Good:
throw new Error(
  `my-plugin: Failed to connect to the API at ${endpoint}. ` +
    `Check your network connection or disable my-plugin in enabled-plugins.json.`
);

// Bad:
throw new Error('Connection failed');
```

Light snark in error messages poking fun at misbehaving plugins is on-brand for A.L.I.C.E.

---

## Testing

Tests use Vitest and should be placed alongside the source file:

```
src/plugins/community/my-plugin/
  my-plugin.ts
  my-plugin.test.ts
```

```typescript
import { describe, it, expect } from 'vitest';

describe('my-plugin', () => {
  it('should do something', () => {
    expect(true).toBe(true);
  });
});
```

The eslint directive `@typescript-eslint/no-explicit-any` is only allowed as a line comment, and only in tests. Never use it elsewhere.

---

## Complete Example: Greeter Plugin

Here's a fictional `greeter` plugin that demonstrates all major features:

```typescript
// src/plugins/community/greeter/greeter.ts
import { AlicePlugin } from '../../../lib.js';
import { Type } from 'typebox';
import path from 'node:path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// Step 1: Declare the offered API type
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    greeter: {
      getGreeting: (name: string) => string;
    };
  }
}

const GreetParameters = Type.Object({
  name: Type.String({ description: 'The name of the person to greet' }),
});

const greeterPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'greeter',
    name: 'Greeter',
    version: '1.0.0',
    description: 'A friendly greeting plugin that also shows up in the web UI.',
    dependencies: [
      { id: 'memory', version: 'LATEST' },
      { id: 'web-ui', version: 'LATEST' },
    ],
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    // Step 2: Load configuration
    const config = await plugin.config(
      Type.Object({
        defaultGreeting: Type.String({ default: 'Hello' }),
        enthusiasm: Type.Number({ default: 1, minimum: 1, maximum: 5 }),
      }),
      { defaultGreeting: 'Hello', enthusiasm: 1 }
    );

    // Step 3: Request dependencies
    const memory = plugin.request('memory');
    const webUi = plugin.request('web-ui');

    // Step 4: Register a tool
    plugin.registerTool({
      name: 'greet',
      availableFor: ['chat', 'voice'],
      description: 'Greets a person by name.',
      parameters: GreetParameters,
      systemPromptFragment: type =>
        `You can greet people using the greet tool. The greeting style is: ${config.getPluginConfig().defaultGreeting}.`,
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async args => {
        const { name } = args as { name: string };
        const greeting = config.getPluginConfig().defaultGreeting;
        const message = `${greeting}, ${name}!`;
        if (memory) {
          await memory.saveMemory(`Greeted ${name}`);
        }
        return message;
      },
    });

    // Step 5: Register a footer prompt
    plugin.registerFooterSystemPrompt({
      name: 'greeterFooter',
      weight: 100,
      getPrompt: () => {
        const settings = config.getPluginConfig();
        return `The greeter plugin is active. Default greeting: "${settings.defaultGreeting}". Enthusiasm level: ${settings.enthusiasm}.`;
      },
    });

    // Step 6: Register web UI assets
    if (webUi) {
      webUi.registerScript(path.join(currentDir, 'greeter-web-ui.js'));
      webUi.registerStylesheet(path.join(currentDir, 'greeter-web-ui.css'));
    }

    // Step 7: Use lifecycle hooks
    plugin.hooks.onAssistantAcceptsRequests(async () => {
      console.log('Greeter plugin is ready!');
    });

    // Step 8: Offer an API to other plugins
    plugin.offer<'greeter'>({
      getGreeting: (name: string) => {
        const settings = config.getPluginConfig();
        return `${settings.defaultGreeting}, ${name}!`;
      },
    });
  },
};

export default greeterPlugin;
```

And the corresponding web UI client:

```typescript
// src/plugins/community/greeter/greeter-web-ui.tsx
import type {
  AliceUIExtensionApi,
  PluginClientExport,
} from '../../system/web-ui/client/types/index.js';

type ReactModule = typeof import('react');
const React = (globalThis as typeof globalThis & { React?: ReactModule }).React;

function GreeterWidget() {
  const [greeting, setGreeting] = React.useState('Loading...');

  React.useEffect(() => {
    fetch('/api/greeter/status')
      .then(res => res.json())
      .then(data => setGreeting(data.greeting))
      .catch(() => setGreeting('Unavailable'));
  }, []);

  return React.createElement('div', { className: 'greeter-widget' }, greeting);
}

const greeterExtension: PluginClientExport = {
  onAliceUIReady(api: AliceUIExtensionApi) {
    api.registerComponent('sidebar-bottom', GreeterWidget);
  },
};

export default greeterExtension;
```

---

## Next Steps

- [Plugin API Reference](./plugin-api.md) — Full API method documentation
- [Plugin Hooks](./plugin-hooks.md) — All lifecycle and event hooks
- [Offered APIs](./plugin-offered-apis.md) — APIs offered by system plugins
- [Web UI Extension](./plugin-web-ui.md) — Adding React components and stylesheets
- [Task Assistants](./plugin-task-assistants.md) — Creating focused sub-conversations
- [Session-Linked Agents](./plugin-agents.md) — Creating autonomous multi-turn agents
- [Personality System](./plugin-personality.md) — Providing personality prompts
- [Broker Pattern](./plugin-broker-pattern.md) — Creating broker plugins
- [Type Reference](./plugin-types-reference.md) — All plugin-facing types in one place
- [Conventions](./plugin-conventions.md) — Coding standards for plugins
