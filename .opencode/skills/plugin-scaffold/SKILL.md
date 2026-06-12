---
name: plugin-scaffold
description: Use when creating a new plugin for Alice. Trigger phrases: "new plugin", "create plugin", "scaffold plugin", "plugin boilerplate", "plugin template".
---

# Plugin Scaffold

Plugins live in `src/plugins/system/` (built-in) or `src/plugins/community/` (optional). User plugins go in `~/.alice-assistant/user-plugins/`.

## Minimal Plugin Structure

```typescript
import type { AlicePlugin } from '../../../lib/types/alice-plugin-interface.js';

export const myPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'my-plugin',
    name: 'My Plugin',
    brandColor: '#FF0000', // Currently only used for color-coding the plugin name in log messages, but may be used elsewhere in the UI to identify the plugin in the future.
    description: 'One or two sentence description.',
    version: '0.0.1', // Semver format, or the literal string LATEST, which is an alias to the version of the currently running assistant. "LATEST" may only be used by built-in plugins (community and system). This version is used by the dependency resolver to determine if a plugin's dependencies are satisfied.
    dependencies: [{ id: 'other-plugin', version: '1.2.3' }], // Optional hard dependencies. The assistant will refuse to load this plugin if any of these dependencies are missing or don't match the specified version requirement.
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(); // Will not resolve until all declared dependencies are fully registered. The `plugin` object is your main interface for interacting with the assistant — use it to register tools, hooks, system prompts, and more.
    plugin.logger.info('Registered.'); // plugin.logger automatically prepends the plugin name to all log messages for you. Don't repeat it in the message.
  },
};
```

## pluginMetadata Fields

| Field          | Required | Notes                                                                                     |
| -------------- | -------- | ----------------------------------------------------------------------------------------- |
| `id`           | Yes      | kebab-case, unique                                                                        |
| `name`         | Yes      | Human-readable                                                                            |
| `brandColor`   | Yes      | Hex color for log prefix and future UI identification                                     |
| `description`  | Yes      | Shown in plugin list                                                                      |
| `version`      | Yes      | Semver, or `LATEST` for built-in plugins                                                  |
| `dependencies` | No       | Array of `{ id: string, version: string }` objects — hard dependencies with semver ranges |

## Registering Functionality

### Tools

```typescript
import { Type } from '@sinclair/typebox';

plugin.registerTool({
  name: 'my_tool',
  availableFor: ['chat', 'voice', 'autonomy'],
  description: 'What the tool does.',
  systemPromptFragment: '',
  parameters: Type.Object({
    arg: Type.String({ description: 'The argument.' }),
  }),
  async execute({ arg }) {
    return `Processed: ${arg}`;
  },
});
```

Use Typebox for all schemas — it provides type inference and cleaner syntax. For more complex schemas:

```typescript
import { Type } from '@sinclair/typebox';

parameters: Type.Object({
  name: Type.String(),
  age: Type.Number(),
});
```

### Lifecycle Hooks

```typescript
plugin.hooks.onAllPluginsLoaded(async () => {
  plugin.logger.info('All plugins loaded.');
});

plugin.hooks.onAssistantAcceptsRequests(async () => {
  plugin.logger.info('Ready to accept requests.');
});

plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
  plugin.logger.info('Shutting down.');
});
```

Log before and after hook body for debugging.

## Inter-Plugin Communication

### Offering a Capability

```typescript
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'my-plugin': {
      myMethod: (arg: string) => Promise<string>;
    };
  }
}

plugin.offer<'my-plugin'>({
  myMethod: async arg => {
    return `result: ${arg}`;
  },
});
```

### Requesting a Capability

```typescript
const restServe = plugin.request('rest-serve');
if (!restServe) {
  // Plugin loading conventions guarantee that dependencies are loaded before the plugin itself, so if you declared 'rest-serve' as a dependency in pluginMetadata, you can be confident it's available here. The only way this throws is if rest-serve unexpectedly doesn't offer any API, so this check is slightly excessive, but harmless.
  throw new Error('[my-plugin] rest-serve plugin not available.');
}
```

Check the `dependencies` array to ensure the plugin is available before requesting.

## Registering the Plugin

### Built-in Plugins (system or community)

Add an entry to `src/plugins/system-plugins.json`. This file is a JSON array of plugin definitions — both system and community plugins live here, distinguished by the `category` field:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "category": "system",
  "required": false
}
```

| Field      | Notes                                                                            |
| ---------- | -------------------------------------------------------------------------------- |
| `id`       | kebab-case, must match `pluginMetadata.id`                                       |
| `name`     | Human-readable                                                                   |
| `category` | `"system"` or `"community"`                                                      |
| `required` | If `true`, the assistant refuses to start if this plugin is disabled by the user |

The plugin module file must live at `src/plugins/{category}/{id}/{id}.ts` (e.g. `src/plugins/system/my-plugin/my-plugin.ts`). The loader resolves it at runtime as `{category}/{id}/{id}.js` after build.

### Enabling the Plugin

Plugins are enabled/disabled by the user in `~/.alice-assistant/plugin-settings/enabled-plugins.json`, not by editing `system-plugins.json`. The default enabled state for each built-in plugin is defined in the loader's `defaultEnabledPlugins` map. Required plugins are always forced on.

### User Plugins

User plugins live in `~/.alice-assistant/user-plugins/{plugin-id}/` and need two files:

- `{plugin-id}.js` — the compiled plugin module (default export of `AlicePlugin`)
- `plugin.json` — metadata: `{ "id": "my-plugin", "name": "My Plugin" }`

The user then enables it in `enabled-plugins.json` under `user.plugins`.

After creating a plugin, run `npm run build` and test with `npm start`.
