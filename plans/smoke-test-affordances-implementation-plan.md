# Implementation Plan: Smoke Test Affordances

## Overview

Add two environment-variable-based affordances for smoke testing:

1. **`ALICE_CONFIG_DIR`** — Override the config directory from `~/.alice-assistant` to an arbitrary path, with auto-scaffold behavior preserved.
2. **`ALICE_SMOKE_TEST`** — After all plugins load, the startup conversation runs, and the assistant is fully accepting requests (REST server listening, voice client spawned), run the clean shutdown sequence and exit successfully instead of entering the main loop.

Both changes are minimal, contained to two files, and do not alter the ordinary startup flow when the env vars are absent.

## Requirements Summary

| #   | Requirement                                                                                                   | Type           |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------- |
| R1  | `ALICE_CONFIG_DIR` env var overrides the config directory path                                                | Functional     |
| R2  | When the overridden directory does not exist, auto-scaffold from `config-default/` (same as default behavior) | Functional     |
| R3  | When `ALICE_CONFIG_DIR` is unset, behavior is identical to current (no regression)                            | Non-functional |
| R4  | `ALICE_SMOKE_TEST` env var causes the assistant to exit cleanly after `onAssistantAcceptsRequests` completes  | Functional     |
| R5  | Smoke test exit runs the full shutdown hook sequence (not an immediate `process.exit`)                        | Functional     |
| R6  | When `ALICE_SMOKE_TEST` is unset, behavior is identical to current (no regression)                            | Non-functional |
| R7  | Changes are limited to `src/lib/user-config.ts` and `src/lib/alice-core.ts`                                   | Scope          |

### Out of Scope

- CLI flags for either feature (env vars only)
- Waiting for the voice client Python process to report ready
- Any changes to `bin/` entry scripts
- Any changes to `src/index.ts`
- New test files (existing test patterns are unaffected; the env var behavior is trivial to verify manually)

## Architecture & Design

### Config Dir Override

```
process.env.ALICE_CONFIG_DIR
        │
        ▼
   set? ──yes──▶ use that path ──▶ exists? ──no──▶ scaffold from config-default/
        │                                      │
        no                                     yes
        │                                      │
        ▼                                      ▼
   os.homedir() + '.alice-assistant'        return path
   (existing behavior)
```

The override is applied at the single point of truth: `UserConfig.getConfigPath()`. Every consumer of the config path (plugin loader, memory DB path, credential store, personality loader, web-ui user-style path, etc.) calls `getConfigPath()` and will automatically use the override with zero changes.

### Smoke Test Flow

```
AliceCore.start()
  │
  ... (normal startup: load config, load plugins, startup conversation, hooks) ...
  │
  ▼
invokeOnAssistantAcceptsRequests()  ◀── REST server listening, voice client spawned
  │
  ▼
process.env.ALICE_SMOKE_TEST?
  │
  yes ──▶ run shutdown hooks ──▶ return (→ index.ts calls process.exit(0))
  │
  no
  │
  ▼
waitForShutdownSignal()  (existing main loop)
```

The smoke test path reuses the same shutdown hook sequence that the SIGINT/SIGTERM handler uses, ensuring the full lifecycle is exercised.

## Project Structure

No new files. Changes are limited to:

| File                     | Action | Description                                                      |
| ------------------------ | ------ | ---------------------------------------------------------------- |
| `src/lib/user-config.ts` | Modify | Add `ALICE_CONFIG_DIR` check in `getConfigPath()`                |
| `src/lib/alice-core.ts`  | Modify | Add `ALICE_SMOKE_TEST` branch after `onAssistantAcceptsRequests` |

## Implementation Steps

### Step 1: Add `ALICE_CONFIG_DIR` override to `UserConfig.getConfigPath()`

**File:** `src/lib/user-config.ts`
**Complexity:** Low
**Dependencies:** None

In the `getConfigPath()` method (line 19–34), add a check for `process.env.ALICE_CONFIG_DIR` before falling through to `os.homedir()`.

Current code (lines 19–34):

```typescript
getConfigPath: () => {
  const homeDir = os.homedir();
  const configDir = path.join(homeDir, '.alice-assistant');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir);
    // Copy the contents of the config-default folder into the new config directory.
    const defaultConfigDir = path.join(
      currentDir,
      '..',
      '..',
      'config-default'
    );
    fs.cpSync(defaultConfigDir, configDir, { recursive: true });
  }
  return configDir;
},
```

New code:

```typescript
getConfigPath: () => {
  const envOverride = process.env.ALICE_CONFIG_DIR;
  const configDir = envOverride
    ? path.resolve(envOverride)
    : path.join(os.homedir(), '.alice-assistant');

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    const defaultConfigDir = path.join(
      currentDir,
      '..',
      '..',
      'config-default'
    );
    fs.cpSync(defaultConfigDir, configDir, { recursive: true });
  }
  return configDir;
},
```

Key details:

- `path.resolve(envOverride)` handles relative paths in the env var (e.g., `./test-config` resolves against `cwd`).
- `{ recursive: true }` is added to `fs.mkdirSync` to handle deeply nested overridden paths.
- The scaffold-from-default behavior is identical regardless of which path is used.
- The startup log message in `alice-core.ts` line 48–50 already logs the config path, so the override will be visible in logs automatically.

### Step 2: Add `ALICE_SMOKE_TEST` smoke test exit to `AliceCore.start()`

**File:** `src/lib/alice-core.ts`
**Complexity:** Low
**Dependencies:** Step 1 (only for testing the combined behavior; code changes are independent)

After `invokeOnAssistantAcceptsRequests()` completes (line 78), check `process.env.ALICE_SMOKE_TEST`. If truthy, run the shutdown hook sequence and return (allowing `index.ts` to call `process.exit(0)`). If not set, proceed to `waitForShutdownSignal()` as normal.

The shutdown sequence to run is the same four calls from the `shutdown` closure in `waitForShutdownSignal()` (lines 31–34):

```typescript
await PluginHookInvocations.invokeOnAssistantWillStopAcceptingRequests();
await PluginHookInvocations.invokeOnAssistantStoppedAcceptingRequests();
await PluginHookInvocations.invokeOnPluginsWillUnload();
AlicePluginEngine.cleanupWebSocketServers();
```

Current code (lines 78–81):

```typescript
    await PluginHookInvocations.invokeOnAssistantAcceptsRequests();

    await AliceCore.waitForShutdownSignal();
  },
};
```

New code:

```typescript
    await PluginHookInvocations.invokeOnAssistantAcceptsRequests();

    if (process.env.ALICE_SMOKE_TEST) {
      systemLogger.log(
        'ALICE_SMOKE_TEST is set — running clean shutdown and exiting.'
      );
      await PluginHookInvocations.invokeOnAssistantWillStopAcceptingRequests();
      await PluginHookInvocations.invokeOnAssistantStoppedAcceptingRequests();
      await PluginHookInvocations.invokeOnPluginsWillUnload();
      AlicePluginEngine.cleanupWebSocketServers();
      systemLogger.log('Smoke test shutdown complete. Exiting successfully.');
      return;
    }

    await AliceCore.waitForShutdownSignal();
  },
};
```

Key details:

- The shutdown hook calls are identical to the ones in `waitForShutdownSignal`'s `shutdown` closure. No extraction to a shared function is needed — the duplication is two lines of hook invocations and is clearer inline.
- `systemLogger.log()` messages bracket the smoke test shutdown so it's visible in output.
- After `return`, control flows back to `src/index.ts` line 10: `process.exit(0)`.
- The `shuttingDown` guard and signal handler cleanup from `waitForShutdownSignal` are not needed here — there's no concurrent signal to guard against during a synchronous shutdown sequence.

### Step 3: Update AGENTS.md and .github/copilot-instructions.md

**Files:** `AGENTS.md`, `.github/copilot-instructions.md`
**Complexity:** Low
**Dependencies:** Steps 1–2 (documentation describes the implemented behavior)

Add a **"Smoke Testing & Config Overrides"** section to both files documenting the two environment variables.

**AGENTS.md** — Add after the "Configuration" section (after line 209):

````markdown
### Smoke Testing & Config Overrides

Two environment variables support smoke testing and isolated config:

| Variable           | Purpose                                                                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALICE_CONFIG_DIR` | Override the config directory path (default: `~/.alice-assistant`). Auto-scaffolds from `config-default/` if the directory does not exist.                                                                                                                        |
| `ALICE_SMOKE_TEST` | When set to any truthy value, the assistant runs the full startup sequence (load plugins, startup conversation, REST server listen, voice client spawn), then executes the clean shutdown hook sequence and exits successfully instead of entering the main loop. |

Example combined usage:

```bash
ALICE_CONFIG_DIR=/tmp/alice-smoke-test ALICE_SMOKE_TEST=1 npm start
```
````

````

**.github/copilot-instructions.md** — Add after the "Running the Application" section (after line 102, before the "Testing" section):

```markdown
### Smoke Testing & Config Overrides

Two environment variables support smoke testing and isolated config directories:

| Variable            | Purpose                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `ALICE_CONFIG_DIR`  | Override the config directory path (default: `~/.alice-assistant`). Auto-scaffolds from `config-default/` if the directory does not exist. |
| `ALICE_SMOKE_TEST`  | When set to any truthy value, the assistant runs the full startup sequence (load plugins, startup conversation, REST server listen, voice client spawn), then executes the clean shutdown hook sequence and exits successfully instead of entering the main loop. |

Example combined usage:
```bash
ALICE_CONFIG_DIR=/tmp/alice-smoke-test ALICE_SMOKE_TEST=1 npm start
````

````

## File Changes Summary

| File | Action | Lines Changed | Description |
|------|--------|---------------|-------------|
| `src/lib/user-config.ts` | Modify | ~6 lines in `getConfigPath()` | Add `ALICE_CONFIG_DIR` env var check; add `{ recursive: true }` to `mkdirSync` |
| `src/lib/alice-core.ts` | Modify | ~10 lines after line 78 | Add `ALICE_SMOKE_TEST` branch with clean shutdown sequence |
| `AGENTS.md` | Modify | ~15 lines after Configuration section | Document `ALICE_CONFIG_DIR` and `ALICE_SMOKE_TEST` |
| `.github/copilot-instructions.md` | Modify | ~15 lines after Running the Application section | Document `ALICE_CONFIG_DIR` and `ALICE_SMOKE_TEST` |

## Testing Strategy

### Manual Smoke Test

```bash
# 1. Create a temporary config directory
mkdir -p /tmp/alice-smoke-test

# 2. Run smoke test with override
ALICE_CONFIG_DIR=/tmp/alice-smoke-test ALICE_SMOKE_TEST=1 npm start

# Expected: assistant scaffolds config, loads plugins, runs startup conversation,
#           REST server listens, voice client spawns, then clean shutdown and exit 0.
````

### Manual Regression Test (no env vars)

```bash
# Normal startup — must behave identically to before
npm start
# Expected: enters main loop, waits for Ctrl+C
```

### Manual Config Dir Override Only (no smoke test)

```bash
ALICE_CONFIG_DIR=/tmp/alice-smoke-test npm start
# Expected: uses /tmp/alice-smoke-test for config, enters main loop normally
```

### Unit Tests

No new unit test files are needed. The changes are trivial env var checks that are more reliably verified via manual integration testing. Existing tests that mock `UserConfig.getConfigPath` (e.g., `memory.test.ts`, `web-ui.test.ts`, `personality.test.ts`) continue to work unchanged since they mock at the function level, bypassing the env var check.

## Definition of Done

- [ ] `ALICE_CONFIG_DIR=/some/path npm start` uses `/some/path` as the config directory (verify via startup log message)
- [ ] `ALICE_CONFIG_DIR=/some/new/path npm start` auto-scaffolds config from `config-default/` when the path doesn't exist
- [ ] `npm start` (no env vars) uses `~/.alice-assistant` as before (no regression)
- [ ] `ALICE_SMOKE_TEST=1 npm start` runs the full startup sequence, then cleanly shuts down and exits with code 0
- [ ] `ALICE_SMOKE_TEST=1 npm start` shutdown log messages appear: "running clean shutdown", REST server shutdown, voice client stop, "Smoke test shutdown complete"
- [ ] `npm start` (no `ALICE_SMOKE_TEST`) enters the main loop and waits for SIGINT as before (no regression)
- [ ] `npm run lint` passes with no new warnings
- [ ] `npm test` passes with no regressions

## Risks & Mitigations

| Risk                                                                                                                           | Impact                                                         | Mitigation                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `path.resolve()` on an empty string returns `cwd`, which could cause unintended behavior if `ALICE_CONFIG_DIR` is set to empty | Low — empty env vars are unusual in smoke test scenarios       | The `envOverride` check uses truthiness; an empty string is falsy in JS, so it falls through to the default path. No risk.                                                                       |
| Smoke test shutdown hooks could hang if a plugin's shutdown handler never resolves                                             | Medium — would cause the smoke test to hang instead of exiting | The existing shutdown hooks already have timeouts (REST server has a 5s force-close timer; voice client has a 5s SIGKILL fallback). No new timeout logic needed.                                 |
| `{ recursive: true }` on `mkdirSync` could mask permission errors on parent directories                                        | Low                                                            | The existing code already calls `mkdirSync` without `recursive` and would fail on missing parents anyway. Adding `recursive` only helps the override case where the user provides a nested path. |

## Timeline Estimate

~15 minutes. Two files, ~16 lines of net-new code, no new tests, no new dependencies.
