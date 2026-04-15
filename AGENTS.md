# AGENTS.md — A.L.I.C.E. Assistant

## Project Overview

A.L.I.C.E. Assistant is a local-first, personality-driven AI assistant written in TypeScript (ESM) on Node.js v22+. Ollama is the default LLM backend. The app exposes a React-based web UI, a plugin architecture for extensibility, and a growing task-assistant and voice runtime surface.

## Build Commands

| Command                   | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `npm install`             | Install dependencies                                             |
| `npm run build`           | Full build (server + client + plugin UI bundles)                 |
| `npm run build:server`    | Compile TypeScript via `tsc`, then copy non-TS assets to `dist/` |
| `npm run build:client`    | Bundle React web UI client with esbuild                          |
| `npm run build:plugin-ui` | Bundle community plugin UIs (e.g. mood) with esbuild             |
| `npm run clean`           | Remove `dist/`                                                   |
| `npm start`               | Run `node dist/index.js` (must build first)                      |

## Test Commands

| Command                                       | Purpose                                 |
| --------------------------------------------- | --------------------------------------- |
| `npm test`                                    | Run full test suite once (`vitest run`) |
| `npm run test:watch`                          | Run tests in watch mode                 |
| `npm run test:coverage`                       | Run suite with V8 coverage              |
| `npx vitest run src/lib/conversation.test.ts` | Run a single test file                  |
| `npx vitest run src/lib/`                     | Run all tests under a directory         |
| `npx vitest run -t "test name pattern"`       | Run tests matching a name pattern       |

Test files are co-located: `src/**/*.test.ts`. Tests use the `node` environment. Mock external modules with `vi.mock()` at the top level (hoisted).

## Lint & Format Commands

| Command                  | Purpose                                |
| ------------------------ | -------------------------------------- |
| `npm run lint`           | Run ESLint (fix) then Prettier (write) |
| `npm run lint:eslint`    | ESLint with `--fix` on `src/`          |
| `npm run lint:prettier`  | Prettier write on all files            |
| `npx prettier --check .` | Check formatting without writing       |

Husky hooks: pre-commit runs `lint-staged`; pre-push runs `npm test` on `main` only.

## Code Style

### Imports

- ESM throughout. Use explicit `.js` extensions for all local/relative imports.
- Use `node:` prefix for Node.js built-in modules (e.g. `node:fs`, `node:crypto`).
- Use `import type` for type-only imports to keep emitted JS clean.

```typescript
import { Foo } from './foo.js';
import * as fs from 'node:fs';
import type { AlicePlugin } from './types/alice-plugin-interface.js';
```

### Formatting (Prettier)

- Single quotes
- Trailing commas: `es5`
- Indent: 2 spaces
- Semicolons: always
- Arrow function parens: avoid (i.e. `x => x` not `(x) => x`)

### TypeScript

- Target: ES2022, Module: NodeNext, JSX: react-jsx
- Strict mode enabled
- `experimentalDecorators` and `emitDecoratorMetadata` are on (MikroORM)
- Use Typebox (`typebox`) for plugin config schemas and tool parameter definitions
- Avoid `any` in production code. `@typescript-eslint/no-explicit-any` is only allowed as an inline comment suppress in test files — never in application code.
- Prefer explicit, descriptive error messages over generic ones.

### Naming Conventions

| Context                      | Style                         | Example                          |
| ---------------------------- | ----------------------------- | -------------------------------- |
| Source files                 | kebab-case                    | `web-search-broker.ts`           |
| Classes / types / interfaces | PascalCase                    | `AlicePluginInterface`           |
| Variables / functions        | camelCase                     | `loadPlugins`                    |
| Plugin IDs                   | kebab-case                    | `web-ui`, `notifications-broker` |
| DB entity classes            | PascalCase (plugin prefix OK) | `MoodEntry`, `ReminderItem`      |
| Test file suffix             | `.test.ts` (co-located)       | `conversation.test.ts`           |

### Error Handling

- Produce explicit, user-actionable errors that name the offending plugin and describe recovery steps.
- Light snark poking fun at misbehaving plugins is on-brand, but the error must still be actionable.
- Prefer throwing over silently swallowing errors in core runtime.

### Plugin Architecture

- Most meaningful features should be implemented as plugins, not wired directly into core.
- Plugins use `registerPlugin()` to receive a scoped API for registering tools, prompts, conversation types, task assistants, hooks, and inter-plugin dependencies.
- Lifecycle hooks (`onAllPluginsLoaded`, `onAssistantWillAcceptRequests`, etc.) must emit log messages with a clear prefix before and after the hook body.
- Plugin dependencies are declared in `pluginMetadata.dependencies`. Use `offer()`/`request()` for typed inter-plugin capabilities.
- The `memory` plugin owns database persistence. Other plugins should depend on `memory` rather than creating their own DB stacks.
- Built-in plugins live in `src/plugins/system/` and `src/plugins/community/`. User plugins go in `~/.alice-assistant/user-plugins/`.

### Configuration

- Main config: `~/.alice-assistant/alice.json`
- Plugin config: `~/.alice-assistant/plugin-settings/<plugin-id>/<plugin-id>.json`
- Plugin enablement: `~/.alice-assistant/plugin-settings/enabled-plugins.json`
- Personality files: `~/.alice-assistant/personality/` (markdown, loaded alphabetically)

## Repository Layout (Key Paths)

```text
src/index.ts                          # Main entry point
src/lib.ts                            # Public re-export surface
src/lib/                              # Core framework modules
src/lib/types/                         # Shared TypeScript types
src/lib/node/                          # Promisified Node helpers
src/plugins/system-plugins.json        # Built-in plugin registry
src/plugins/system/                    # Required and optional system plugins
src/plugins/community/                 # Optional community plugins
src/plugins/system/web-ui/client/      # React web UI client (esbuild bundle)
config-default/                        # First-run scaffold copied to ~/.alice-assistant/
bin/                                   # CLI entry scripts
vitest.config.ts
eslint.config.mjs
tsconfig.json
```

## When Editing Code

1. Always run `npm run lint` and `npm test` after making changes to verify correctness.
2. Co-locate test files with the modules they test (`*.test.ts` in the same directory).
3. Use `vi.mock()` for external dependencies in tests; mock at the top level so vitest can hoist them.
4. When adding a new tool, register it through the plugin system — do not add it to `src/lib/tools.ts` directly.
5. When adding a new plugin, update `src/plugins/system-plugins.json` if it should be a built-in plugin.
6. Preserve the `.js` extension convention in all imports; the project relies on NodeNext module resolution.
7. Do not commit to `main` without ensuring tests pass.
8. Agentic features must be disabled by default; cloud model integrations must be disabled by default and the project must remain local-model-first.
