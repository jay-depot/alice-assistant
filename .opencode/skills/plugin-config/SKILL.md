---
name: plugin-config
description: Use when adding user-facing configuration to a plugin. Trigger phrases: "plugin config", "plugin settings", "Typebox schema", "config schema", "user settings", "plugin.config".
---

# Plugin Configuration

Use `plugin.config()` to load typed, user-editable configuration for your plugin. Config is stored in `~/.alice-assistant/plugin-settings/<plugin-id>/<plugin-id>.json` and scaffolded with defaults on first run.

## Defining the Schema

Use Typebox to define your config schema:

```typescript
import Type from 'typebox';

const MyPluginConfigSchema = Type.Object({
  apiKey: Type.Optional(
    Type.String({
      description: 'Optional API key. Falls back to the MY_API_KEY env var.',
    })
  ),
  maxResults: Type.Number({ default: 10, minimum: 1, maximum: 100 }),
  enableFeature: Type.Boolean({ default: false }),
});
```

## Defining Defaults

Provide a defaults object matching the schema:

```typescript
const defaultConfig = {
  maxResults: 10,
  enableFeature: false,
};
```

Optional fields with no default can be omitted from the defaults object.

## Loading Config

Call `plugin.config()` during `registerPlugin`:

```typescript
async registerPlugin(pluginInterface) {
  const plugin = await pluginInterface.registerPlugin();
  const config = await plugin.config(MyPluginConfigSchema, defaultConfig);

  // Access plugin-specific config:
  const maxResults = config.getPluginConfig().maxResults;

  // Access system-wide config (alice.json):
  const systemConfig = config.getSystemConfig();
}
```

`plugin.config()` automatically:

- Creates the config directory and file with defaults if they don't exist
- Validates the existing config against the schema on every load
- Throws with a clear error if validation fails

## Full Example

```typescript
import type { AlicePlugin } from '../../../lib/types/alice-plugin-interface.js';
import Type from 'typebox';

const MyPluginConfigSchema = Type.Object({
  apiKey: Type.Optional(Type.String({ description: 'Optional API key.' })),
  maxResults: Type.Number({ default: 10, minimum: 1, maximum: 100 }),
});

const defaultConfig = {
  maxResults: 10,
};

export const myPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'my-plugin',
    name: 'My Plugin',
    brandColor: '#4f46e5',
    description: 'Example plugin with config.',
    version: '0.0.1',
    dependencies: [],
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config(MyPluginConfigSchema, defaultConfig);

    plugin.logger.info(`Max results: ${config.getPluginConfig().maxResults}`);
  },
};
```
