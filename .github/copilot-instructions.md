# A.L.I.C.E. Assistant — Copilot Agent Instructions

## Project Overview

A.L.I.C.E. Assistant is a local-first, personality-driven AI assistant written in TypeScript using ESM on Node.js v22+. Ollama is the default LLM backend. The app exposes a React-based web UI, a plugin architecture for extensibility, and a growing task-assistant and voice runtime surface.

The project is still evolving. The web chat experience, plugin engine, task assistant infrastructure, and persistent memory are functional. Voice support now exists as a managed local client plus token-protected local endpoints, but that stack is still actively changing.

---

## Repository Layout

```text
alice-assistant/
├── src/
│   ├── index.ts                         # Main entry point
│   ├── lib.ts                           # Public API surface (re-exports)
│   ├── lib/                             # Core framework
│   │   ├── alice-core.ts                # Startup / shutdown orchestration
│   │   ├── alice-plugin-engine.ts       # Plugin registration and capability wiring
│   │   ├── alice-plugin-loader.ts       # Built-in and user plugin loading
│   │   ├── conversation.ts              # LLM conversation runtime
│   │   ├── conversation-types.ts        # Built-in and plugin-defined conversation types
│   │   ├── dynamic-prompt.ts            # Weighted prompt assembly
│   │   ├── plugin-hooks.ts              # Lifecycle and event hook dispatch
│   │   ├── task-assistant.ts            # Task assistant orchestration helpers
│   │   ├── tools.ts                     # Tool registration and routing
│   │   ├── user-config.ts               # Config scaffolding and loading
│   │   ├── *.test.ts                    # Vitest coverage for core behavior
│   │   ├── node/                        # Promisified Node helpers
│   │   └── types/                       # Shared TypeScript types
│   └── plugins/
│       ├── system-plugins.json          # Built-in plugin registry and required flags
│       ├── system/                      # Built-in system plugins
│       └── community/                   # Shipped optional/community plugins
├── config-default/                      # First-run scaffold copied into ~/.alice-assistant/
│   ├── alice.json
│   ├── personality/
│   ├── example-personalities/
│   ├── plugin-settings/
│   │   ├── enabled-plugins.json
│   │   ├── personality-facets/
│   │   ├── moltbook/
│   │   └── voice/
│   ├── tool-settings/
│   ├── user-plugins/
│   ├── wake-word-models/
│   └── web-interface/
│       └── custom-style.css
├── bin/
│   ├── alice-assistant-setup
│   └── alice-assistant-start
├── plans/                               # Human-written planning docs
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── eslint.config.mjs
```

---

## Build

```bash
npm install
npm run build
```

Current build scripts:

| Script                    | What it does                                                             |
| ------------------------- | ------------------------------------------------------------------------ |
| `npm run build`           | Runs server compilation plus the React client and plugin UI bundles      |
| `npm run build:server`    | Runs `tsc`, then `post-build` to copy non-TS runtime assets into `dist/` |
| `npm run build:client`    | Bundles `src/plugins/system/web-ui/client/index.tsx` with esbuild        |
| `npm run build:plugin-ui` | Bundles `src/plugins/community/mood/mood-web-ui.tsx` with esbuild        |
| `npm run clean`           | Removes `dist/`                                                          |

`post-build` currently copies `.js`, `.html`, `.css`, `.json`, `.md`, `.py`, and `.txt` assets into `dist/`.

---

## Running the Application

Default runtime assumes a local Ollama instance, typically at `http://127.0.0.1:11434`.

```bash
npm run build
npm run start
```

On first run, the assistant scaffolds `~/.alice-assistant/` from `config-default/`.

Important runtime notes:

- The web UI defaults to `http://localhost:47153` unless changed in config.
- Enabled plugin state lives in `~/.alice-assistant/plugin-settings/enabled-plugins.json`.
- The voice plugin is a required built-in plugin and supervises a managed local voice client when enabled.
- Optional external integrations still include services like Piper TTS, Whisper, OpenWakeWord, Brave Search, Currents, and Moltbook depending on plugin configuration.

---

## Testing

Vitest is configured and should be used for automated tests.

```bash
npm test
npm run test:watch
npm run test:coverage
```

Test configuration currently targets:

- `src/**/*.test.ts`
- Node test environment

Existing tests cover core runtime areas including conversation types, conversations, dynamic prompts, personality prompt assembly, render helpers, task assistants, tools, and tilde expansion.

The eslint directive `@typescript-eslint/no-explicit-any` is only allowed as a line comment, and only in tests. Never use it elsewhere.

---

## Linting & Formatting

```bash
npx eslint src/
npx prettier --check .
```

ESLint uses the flat config in `eslint.config.mjs`. Prettier is available but not enforced by a repository hook.

---

## Plugin Architecture

The plugin system is central to the project. Most meaningful features should be implemented as plugins rather than wired directly into core.

### Plugin Shape

```typescript
// src/lib/types/alice-plugin-interface.ts
export type AlicePlugin = {
  pluginMetadata: AlicePluginMetadata;
  registerPlugin: (api: AlicePluginInterface) => Promise<void>;
};
```

Inside `registerPlugin`, plugins call `await pluginInterface.registerPlugin()` to receive a plugin-scoped API.

### Plugin-Scoped API

After registration, a plugin can:

| Method                                                  | Purpose                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `registerTool(def)`                                     | Register an LLM-callable tool                                                     |
| `registerHeaderSystemPrompt(def)`                       | Inject prompt content before conversation turns                                   |
| `registerFooterSystemPrompt(def)`                       | Inject prompt content after conversation turns                                    |
| `registerConversationType(def)`                         | Add a plugin-defined conversation type                                            |
| `registerTaskAssistant(def)`                            | Register a task assistant definition                                              |
| `addToolToConversationType(typeId, pluginId, toolName)` | Attach an existing tool to a conversation type                                    |
| `config<T>(schema, defaults)`                           | Load typed plugin config from `~/.alice-assistant/plugin-settings/<id>/<id>.json` |
| `offer(capabilities)`                                   | Expose an API to dependent plugins                                                |
| `request(pluginId)`                                     | Access another plugin's offered API                                               |
| `hooks`                                                 | Register lifecycle and event callbacks                                            |

### Lifecycle Hooks

Current hook surface includes:

```typescript
hooks.onAllPluginsLoaded(async () => {
  /* all enabled plugins loaded */
});
hooks.onAssistantWillAcceptRequests(async () => {
  /* startup is about to finish */
});
hooks.onAssistantAcceptsRequests(async () => {
  /* assistant is live */
});
hooks.onAssistantWillStopAcceptingRequests(async () => {
  /* shutdown is beginning */
});
hooks.onAssistantStoppedAcceptingRequests(async () => {
  /* requests have stopped */
});
hooks.onPluginsWillUnload(async () => {
  /* final shutdown cleanup */
});
hooks.onTaskAssistantWillBegin(async instance => {
  /* task assistant started */
});
hooks.onTaskAssistantWillEnd(async (instance, result) => {
  /* task assistant ended */
});
```

**EMIT LOG MESSAGES AROUND ALL LIFECYCLE HOOKS!** Use console.log with a clear prefix, e.g. `plugin.logger.log('[MyPlugin] <hook name>: Starting adorable pug delivery service...'); [HOOK BODY] plugin.logger.log('[MyPlugin] <hook name>: ...adorable pug delivery service started.');` so that when a plugin breaks the startup or shutdown process, it's easier to identify which plugin is responsible and what the last successful step was.

### Event Hooks

Additional event-style hooks currently exposed to plugins:

```typescript
hooks.onUserConversationWillBegin(async (conversation, type) => {
  /* before first real user turn */
});
hooks.onUserConversationWillEnd(async (conversation, type) => {
  /* before conversation teardown */
});
hooks.onContextCompactionSummariesWillBeDeleted(async summaries => {
  /* before old summaries are dropped */
});
```

### Conversation Types and Task Assistants

Core built-in conversation types are:

- `voice`
- `chat`
- `startup`
- `autonomy`

Plugins can register additional conversation types and task assistants. For focused sub-conversations, prefer the task assistant helpers in `src/lib/task-assistant.ts` instead of building custom orchestration from scratch.

### Plugin Dependencies

Dependencies are declared in `pluginMetadata.dependencies`. The engine waits for dependencies to load before completing plugin registration. Use `offer()` and `request()` for typed inter-plugin capabilities.

For TypeScript typing, augment `PluginCapabilities` in your plugin module:

```typescript
declare module '@/lib/types/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'my-plugin-id': { someMethod(): void };
  }
}
```

### System vs. User Plugins

|                   | Built-in shipped plugins                                  | User plugins                                              |
| ----------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| Locations         | `src/plugins/system/`, `src/plugins/community/`           | `~/.alice-assistant/user-plugins/`                        |
| Built-in registry | `src/plugins/system-plugins.json`                         | none                                                      |
| Enablement config | `~/.alice-assistant/plugin-settings/enabled-plugins.json` | `~/.alice-assistant/plugin-settings/enabled-plugins.json` |
| Can be `required` | Yes, from the built-in registry                           | No                                                        |
| Magic version     | Built-ins may use `LATEST`                                | Must use real semver                                      |
| Category          | `system` or `community`                                   | not built-in                                              |

Current required built-in plugins are:

- `datetime`
- `system-info`
- `memory`
- `scratch-files`
- `location-broker`
- `notifications-broker`
- `reminders-broker`
- `web-ui`
- `voice`

### Web UI Extensions

The web UI still supports extension regions for plugin-provided UI. Plugins typically integrate by:

1. Registering built assets through the `web-ui` plugin's `registerScript()` and `registerStylesheet()` capabilities.
2. Exporting an `onAliceUIReady(api)` function from the client script.
3. Registering components into one of these regions:

| Slot name        | Location                    |
| ---------------- | --------------------------- |
| `sidebar-top`    | Top of the sidebar          |
| `sidebar-bottom` | Bottom of the sidebar       |
| `chat-header`    | Above the chat message list |
| `message-prefix` | Before each chat message    |
| `message-suffix` | After each chat message     |
| `input-prefix`   | Before the input area       |
| `settings-panel` | Inside the settings panel   |

### Database Extension

The `memory` plugin exposes database-related capabilities. Plugins that persist state should depend on `memory` and use its offered API rather than creating their own parallel persistence stack.

---

## Coding Conventions

### File and Identifier Naming

| Context                      | Style                         | Example                          |
| ---------------------------- | ----------------------------- | -------------------------------- |
| Source files                 | kebab-case                    | `web-search-broker.ts`           |
| Classes / types / interfaces | PascalCase                    | `AlicePluginInterface`           |
| Variables / functions        | camelCase                     | `loadPlugins`                    |
| Plugin IDs                   | kebab-case                    | `web-ui`, `notifications-broker` |
| DB entity class names        | PascalCase with plugin prefix | `MoodEntry`, `ReminderItem`      |

### Imports

- Use ESM imports with explicit `.js` extensions for local imports.
- Use `node:` prefixes for Node built-ins.
- Use `import type` for type-only imports.

Examples:

```typescript
import { Foo } from './foo.js';
import * as fs from 'node:fs';
import type { AlicePlugin } from './types/alice-plugin-interface.js';
```

### TypeScript

- Keep code compatible with strict TypeScript and the existing ESLint rules.
- Use Typebox schemas for plugin config and tool parameters.
- MikroORM decorators are enabled.
- Avoid `any` where practical.

### Error Handling in Plugins

Prefer explicit, user-actionable errors that name the offending plugin and describe how to recover, usually by disabling or fixing a specific plugin. _Light_ snark in the error messages poking fun at misbehaving plugins is on-brand.

### Configuration Files

- Main config is scaffolded to `~/.alice-assistant/alice.json`.
- Plugin config lives under `~/.alice-assistant/plugin-settings/<plugin-id>/<plugin-id>.json`.
- Plugin enablement lives in `~/.alice-assistant/plugin-settings/enabled-plugins.json`.
- Legacy tool-level config still exists under `~/.alice-assistant/tool-settings/`.

### Personality Files

Personality content is scaffolded into `~/.alice-assistant/personality/`. The default set includes `intro.md`, `quirks.md`, and `user-wellbeing.md`, and additional markdown files are included in alphabetical order.

---

## Known Issues and Active TODOs

Keep these current repo realities in mind:

| Area               | Current state                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Voice runtime      | Managed voice client and routes exist, but the voice stack is still evolving                                   |
| Application plugin | Still not a complete application launcher                                                                      |
| System info        | Some metrics and helpers remain approximate or incomplete                                                      |
| Config validation  | There is still a standing TODO to improve validation beyond the current approach                               |
| DB typing          | Some database-related areas still need tighter typing                                                          |
| Context compaction | Token counting is still estimated rather than based on true tokenizer output though this is unlikely to change |

---

## Contributing Expectations

From the current repository guidance:

- Implementing TODO comments is generally welcome when the implementation is clean.
- If AI helped generate code, the contributor still needs to be able to explain it.
- Agentic features may be acceptable, but they must be disabled by default and clearly described.
- Cloud-model integrations may be acceptable, but they must be disabled by default and the project must remain local-model-first.
