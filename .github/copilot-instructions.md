# A.L.I.C.E. Assistant — Copilot Agent Instructions

## Project Overview

A.L.I.C.E. Assistant is a **local-first, personality-driven AI voice/chat assistant** written in **TypeScript (ESM, Node.js v22+)**. It uses [Ollama](https://ollama.com/) as the default LLM backend and exposes a React-based web UI for chat. The core design is a **plugin architecture** that lets capabilities be added, removed, or replaced without modifying the framework itself.

The project is **a work in progress**. The web-chat interface and plugin infrastructure are functional; the voice interaction loop (wake word → STT → TTS) is partially implemented.

---

## Repository Layout

```
alice-assistant/
├── src/
│   ├── index.ts                  # Main entry point
│   ├── lib.ts                    # Public API surface (re-exports)
│   ├── lib/                      # Core framework (non-plugin code)
│   │   ├── alice-core.ts         # Startup / shutdown orchestration
│   │   ├── alice-plugin-engine.ts# Plugin registration & API
│   │   ├── alice-plugin-loader.ts# Dynamic plugin discovery & loading
│   │   ├── conversation.ts       # Ollama LLM conversation + tool calling
│   │   ├── tool-system.ts        # Tool/function-call type definitions
│   │   ├── dynamic-prompt.ts     # Weighted system-prompt generation
│   │   ├── plugin-hooks.ts       # Lifecycle hook dispatch
│   │   ├── user-config.ts        # Config file loading / scaffolding
│   │   ├── stt.ts                # Speech-to-text wrapper
│   │   ├── tts.ts                # Text-to-speech wrapper
│   │   ├── voice-turn.ts         # Voice interaction loop
│   │   ├── system-info.ts        # System information helpers
│   │   ├── types/                # Shared TypeScript interfaces
│   │   │   ├── alice-plugin-interface.ts  # AlicePlugin, AlicePluginInterface
│   │   │   ├── alice-plugin-hooks.ts      # AlicePluginHooks
│   │   │   └── system-config-full.ts      # Top-level config shape
│   │   ├── node/                 # Promisified Node.js utilities
│   │   └── system-prompts/       # System prompt template files
│   └── plugins/                  # All built-in plugins
│       ├── system-plugins.json   # Registry of built-in plugins & required flags
│       ├── datetime/
│       ├── memory/               # MikroORM / SQLite persistence
│       ├── web-ui/               # Express + React web interface
│       │   ├── web-ui.ts
│       │   └── client/           # React SPA (TSX)
│       ├── mood/
│       ├── weather-broker/
│       ├── news-broker/
│       ├── web-search-broker/
│       ├── user-files/
│       ├── appointments/
│       ├── daily-goals/
│       ├── application/
│       ├── scratch-files/
│       ├── location-broker/
│       ├── reminders-broker/
│       └── static-location/
├── config-default/               # Shipped defaults, copied to ~/.alice-assistant on first run
│   ├── alice.json                # Main assistant config (model, ports, wake word, etc.)
│   ├── personality/              # Markdown files that shape assistant personality
│   ├── example-personalities/   # Ready-made alternative personas
│   ├── plugin-settings/
│   │   └── enabled-plugins.json  # Enable / disable individual plugins
│   ├── tool-settings/            # Per-tool config JSON files
│   └── user-plugins/             # Directory for user-created plugins
│       └── README.user-plugins.md
├── bin/alice-start               # Shell script CLI entry point
├── plans/                        # Human-written planning docs (not generated)
├── package.json
├── tsconfig.json
└── eslint.config.mjs
```

---

## Build

```bash
npm install
npm run build       # full build (server + React client + plugin UIs)
```

**Individual build steps:**

| Script | What it does |
|--------|-------------|
| `npm run build:server` | `tsc` → compiles all TypeScript under `src/`, outputs to `dist/`, then runs `post-build` to copy `.js`, `.html`, `.css`, `.json` assets |
| `npm run build:client` | esbuild bundles `src/plugins/web-ui/client/index.tsx` → `dist/plugins/web-ui/client/alice-client.js` |
| `npm run build:plugin-ui` | esbuild bundles `src/plugins/mood/mood-web-ui.tsx` → `dist/plugins/mood/mood-web-ui.js` |

Output lands in `dist/` (excluded from source control).

## Running the Application

Requires a running [Ollama](https://ollama.com/) instance (default `http://127.0.0.1:11434`, model `qwen2:7b`).

```bash
npm run build   # must build first
npm run start   # node dist/index.js
```

On first run the assistant scaffolds `~/.alice-assistant/` from `config-default/`. The web UI defaults to `http://localhost:47153`.

Optional external services:
- **Piper TTS** — `http://127.0.0.1:5000` (text-to-speech)
- **OpenWakeWord** — wake-word detection (voice loop, not yet fully wired)
- **Whisper** — speech-to-text (not yet fully wired)

---

## Testing

There is **no test framework configured** at this time. `npm test` exits with an error by design. Do not add a test runner unless the task explicitly requires it.

---

## Linting & Formatting

```bash
npx eslint src/        # TypeScript ESLint (flat config in eslint.config.mjs)
npx prettier --check . # or --write to auto-format
```

ESLint uses `eslint:recommended` + `plugin:@typescript-eslint/recommended` with no project-specific overrides. Prettier is available but not enforced by a pre-commit hook.

---

## Plugin Architecture

Understanding the plugin system is central to almost every change in this repo.

### Plugin Shape

```typescript
// src/lib/types/alice-plugin-interface.ts
export type AlicePlugin = {
  pluginMetadata: AlicePluginMetadata;
  registerPlugin: (api: AlicePluginInterface) => Promise<void>;
};
```

`registerPlugin` receives an `AlicePluginInterface` and calls `api.registerPlugin(pluginMetadata)` to get back a plugin-scoped API object.

### Plugin-Scoped API

After calling `api.registerPlugin(metadata)`, a plugin receives:

| Method | Purpose |
|--------|---------|
| `registerTool(def)` | Add an LLM function-call tool |
| `registerHeaderSystemPrompt(def)` | Inject additional "system" messages into the conversation stream, before the conversation turns |
| `registerFooterSystemPrompt(def)` | Inject additional "system" messages into the conversation stream, after the conversation turns |
| `config<T>(schema, defaults)` | Load typed config from `~/.alice-assistant/plugin-settings/<id>/<id>.json` |
| `offer(capabilities)` | Export an API object to dependent plugins |
| `request(pluginId)` | Receive the API exported by a dependency |
| `hooks` | Register lifecycle and event callbacks (see below) |

### Lifecycle Hooks (`AlicePluginHooks`)

```typescript
hooks.onAllPluginsLoaded(async () => { /* all plugins registered */ });
hooks.onAssistantWillAcceptRequests(async () => { /* about to open to users */ });
hooks.onAssistantAcceptsRequests(async () => { /* web UI is live */ });
hooks.onUserConversationWillBegin(async (conversation, type) => { });
hooks.onToolWillBeCalled(async (tool, args) => { });
hooks.onToolWasCalled(async (tool, args, result) => { });
hooks.onPluginsWillUnload(async () => { /* graceful shutdown */ });
```

### Event Hooks (also `AlicePluginHooks`)

```typescript
hooks.onConversationTurn(async (conversation) => { /* every conversation turn, may not be invoked by core yet, but will be before version 1.0.0 */ });
hooks.onUserConversationWillBegin(async (conversation, type) => { /* called before the first user turn of a new conversation will be processed. May not be invoked by core yet, but will be before version 1.0.0 */ }),
hooks.onUserConversationWillEnd(async (conversation, type) => { /* called after the last user turn of a conversation has been processed, but before the conversation is closed and its context goes out of scope and is lost. May not be invoked by core yet, but will be before version 1.0.0 */ }),
hooks.onToolWillBeCalled(async (tool, args) => {/* called before a tool is called, with the tool definition and the arguments the LLM plans to call it with. May not be invoked by core yet, but will be before version 1.0.0 */})
hooks.onToolWasCalled(async (tool, args, result) => { /* called after a tool has been called, with the tool definition, the arguments, and the result. May not be invoked by core yet, but will be before version 1.0.0 */ }),
hooks.onContextCompactionSummariesWillBeDeleted(async (summaries) => { /* called before old conversation summaries are deleted during context compaction, with the summaries that are about to be deleted. Currently invoked by core and used by the `memory` system plugin. */ }),
```

### Plugin Dependencies

Declare dependencies in `pluginMetadata.dependencies`. The engine holds the dependent plugin's initial `api.registerPlugin(pluginMetadata)` from returning until all dependencies are loaded. Use `api.request('dependency-plugin-id')` to access a dependency's offered API.

### Inter-plugin API (TypeScript Module Augmentation)

To type-check `offer`/`request`, augment `PluginCapabilities` in your plugin file:

```typescript
// In your plugin file
declare module '@/lib/types/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'my-plugin-id': { someMethod(): void };
  }
}
```

### System vs. User Plugins

| | System plugins | User plugins |
|---|---|---|
| Location | `src/plugins/` | `~/.alice-assistant/user-plugins/` |
| Registry | `src/plugins/system-plugins.json` | `enabled-plugins.json` |
| Can be `required` | Yes | No (fatal error if attempted) |
| Magic version | `"LATEST"` | Must be valid semver |
| Prompt weight limit | Unlimited | 0–9999 |

Required system plugins (must load or assistant aborts): `datetime`, `system-info`, `memory`, `scratch-files`, `location-broker`, `reminders-broker`, `web-ui`.

### Web UI Extension (React Region Slots)

Plugins that bundle a `.tsx` UI component can inject it into any of these named slots:

| Slot name | Location in UI |
|-----------|---------------|
| `sidebar-top` | Top of the sidebar |
| `sidebar-bottom` | Bottom of the sidebar |
| `chat-header` | Above the chat message list |
| `message-prefix` | Before each chat message |
| `message-suffix` | After each chat message |
| `input-prefix` | Before the chat input box |
| `settings-panel` | Inside the settings panel |

React client is bundled with esbuild as ESM; the web-ui plugin serves it as a static file.

### Database Extension

The `memory` plugin exposes an API for registering MikroORM entities. Plugins declare a dependency on `memory` and receive a callback once the database is ready (`onDatabaseReady`). Entity class names should be prefixed with the plugin's name to avoid table collisions (e.g., `MoodEntry`, not just `Entry`). Existing entity classes: `ChatSession`, `ChatSessionRound`, `Keyword`, `Memory`, are exempt from this naming convention.

---

## Coding Conventions

### File & Identifier Naming

| Context | Style | Example |
|---------|-------|---------|
| Source files | kebab-case | `web-search-broker.ts` |
| Classes / Types / Interfaces | PascalCase | `AlicePluginInterface` |
| Variables / functions | camelCase | `llmConnection`, `loadPlugin` |
| Plugin IDs | kebab-case | `"web-ui"`, `"reminders-broker"` |
| DB entity class names | PascalCase with plugin prefix | `MoodEntry`, `ReminderItem` |

### Imports

- Always use **ESM** with explicit `.js` extensions for local imports, even for `.ts` source files:
  ```typescript
  import { Foo } from './foo.js'; // correct
  import { Foo } from './foo';    // incorrect
  ```
- Node built-ins use the `node:` prefix:
  ```typescript
  import * as fs from 'node:fs';
  import { readFile } from 'node:fs/promises';
  ```
- Type-only imports use `import type`:
  ```typescript
  import type { AlicePlugin } from './types/alice-plugin-interface.js';
  ```

### TypeScript

- `strict` rules enforced via ESLint (`@typescript-eslint/recommended`)
- Use [Typebox](https://github.com/sinclairzx81/typebox) for all JSON schema definitions (config validation, tool parameter schemas)
- MikroORM decorators are enabled (`experimentalDecorators`, `emitDecoratorMetadata`)
- Avoid `any`; where unavoidable, leave a TODO comment

### Error Handling in Plugins

Throw descriptive errors that name the offending plugin and tell the user which plugin to disable to recover. Example from the engine:

```
Plugin foo attempted to register a tool named "bar", but that name is already
registered by plugin baz. Disable one of these plugins to fix your assistant.
```

### Configuration Files

- Config schemas are defined with `typebox` `Type.Object(...)` shapes
- Defaults are provided alongside the schema in a plain JS object
- Config files live at `~/.alice-assistant/plugin-settings/<plugin-id>/<plugin-id>.json`
- Deprecated tool-level config lives at `~/.alice-assistant/tool-settings/<tool-name>/<tool-name>.json` but should be migrated into plugin-level config where possible.

### Personality Files

Located in `~/.alice-assistant/personality/` (scaffolded from `config-default/personality/`). Plain Markdown. Current files: `intro.md`, `quirks.md`, `user-wellbeing.md`. These are injected into the system prompt at startup. Any additional markdown files in that directory are also then injected in alphabetical order, with their file names "titleized" and used as the section headers. Example: `chill-but-useful.md` becomes `## Chill But Useful` in the "main" system prompt.

---

## Known Issues & Active TODOs

| Area | Issue / TODO |
|------|-------------|
| Testing | No test framework configured (`npm test` exits 1) |
| Voice loop | STT and TTS wrappers exist but are not yet wired into a full wake-word → STT → chat → TTS → audio-output loop |
| Application plugin | `application` plugin does not actually launch applications yet |
| Weather broker | Footer system prompt not yet implemented |
| System info | Some metrics return placeholder/stub data |
| Plugin versioning | Semver dependency range checking is declared but not fully enforced |
| Location config | Needs migration from top-level `alice.json` into the `static-location` plugin config |
| Config validation | `convict` library suggested as replacement for manual Typebox validation (see TODOs) |
| Tool parameter schemas | Some tools list parameters as plain strings; Typebox schemas would be more consistent |
| DB entity typing | Uses `any[]` in some places (noted with TODO comments) |
| Context compaction | Token count estimated by word count, not true tokenization |

---

## Contributing Guidelines (from README)

- PRs implementing TODO comments are generally welcome
- If AI generated the code, you must be able to explain it in your own words
- **No** "heartbeats," webhooks, or autonomous agentic features
- Limited autonomy planned via `autonomy-safe` tool flag (read-only / scratch-only tools shown during timed autonomous prompts)
- Cloud LLM integrations (GPT, Claude, Gemini) must be **disabled by default** and the assistant must remain **local-model-first**
