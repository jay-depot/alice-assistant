# User Plugins

User plugins live in this directory (`~/.alice-assistant/user-plugins/`). Each plugin is a directory containing a JavaScript module that exports an `AlicePlugin` object.

## Quick Start

1. Create a directory for your plugin: `~/.alice-assistant/user-plugins/my-plugin/`
2. Create a `my-plugin.js` file that exports an `AlicePlugin` object
3. Enable your plugin in `~/.alice-assistant/plugin-settings/enabled-plugins.json`

## Documentation

Full plugin documentation is available in the `docs/` directory of the A.L.I.C.E. Assistant source:

- **[Plugin Development Guide](../../docs/plugin-development-guide.md)** — End-to-end guide for building plugins
- **[Plugin API Reference](../../docs/plugin-api.md)** — Core API methods and types
- **[Plugin Hooks](../../docs/plugin-hooks.md)** — Lifecycle and event hooks
- **[Offered APIs](../../docs/plugin-offered-apis.md)** — APIs offered by system plugins
- **[Web UI Extension](../../docs/plugin-web-ui.md)** — Adding React components and stylesheets
- **[Task Assistants](../../docs/plugin-task-assistants.md)** — Creating focused sub-conversations
- **[Session-Linked Agents](../../docs/plugin-agents.md)** — Creating autonomous agents
- **[Personality System](../../docs/plugin-personality.md)** — Providing personality prompts
- **[Broker Pattern](../../docs/plugin-broker-pattern.md)** — Creating broker plugins
- **[Type Reference](../../docs/plugin-types-reference.md)** — All plugin-facing types
- **[Conventions](../../docs/plugin-conventions.md)** — Coding standards

## Rules for User Plugins

- Plugin `version` must be a real semver string — you **cannot** use `"LATEST"`
- Plugin `required` must not be set — only the built-in registry assigns this
- Plugin `builtInCategory` must not be set — only the built-in registry assigns this
- All declared dependencies must exist and be enabled
