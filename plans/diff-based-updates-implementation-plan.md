# Implementation Plan: Diff-Based Updates

## Overview

Replace scattered "write/append" and "full replacement" patterns with a unified `format: full|diff` API. LLMs are excellent at generating diffs — this lets them make targeted edits without re-sending entire file/record contents. Append-only tools become superfluous when `format: diff` can represent the same operation as a no-op patch (empty original → full contents).

## Requirements Summary

### Functional Requirements

- **Centralized diff resolution API** in `src/lib/diff-resolver.ts` supporting `full` (raw contents) and `diff` (unified patch) formats
- **Unified `updateScratchFile`** tool replacing `writeScratchFile` and `appendScratchFile`
- **Unified `updateProficiency`** tool (adds `format` parameter to existing `updateProficiency`)
- **New `updateUserTextFile`** tool in user-files plugin (distinct from `writeUserTextFile`; has additional permission scoping)
- **Unified `updatePersonalityFacet`** tool (adds `format` parameter to existing `updatePersonalityFacet`)
- **Deprecate/remove** `appendScratchFile` and the `append` flag on `updateProficiency`/`updatePersonalityFacet`
- Plugin authors can import and use the diff resolver without reinventing their own

### Technical Constraints

- Use the `diff` npm package (unified diff parse/apply — mature, well-maintained)
- Preserve existing validation (path traversal, file type checks, size limits, allowed paths)
- Preserve plugin config schemas (no breaking changes to config)
- All imports use `.js` extension (ESM project convention)

### Scope Boundaries

- **In scope:** scratch-files, proficiencies, personality-facets, user-files plugins; core diff resolver API
- **Out of scope:** database migrations, breaking changes to config schemas, changes to `readScratchFile`/`readUserTextFile`/`recallProficiency`/`embodyPersonalityFacet`

---

## Architecture & Design

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Tool Layer                                │
│  updateScratchFile  │  updateProficiency  │  updatePersonalityFacet │
│                              │                                      │
│                    updateUserTextFile (new)                         │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Core Diff Resolver API                           │
│                    src/lib/diff-resolver.ts                         │
│                                                                     │
│   resolveContents(original: string, format, contents) => string     │
│   - format === 'full': return contents as-is                       │
│   - format === 'diff': parse patch, apply to original, return new  │
│                                                                     │
│   Errors are "soft" — log to console, tell the LLM it's being dumb, │
│   let it retry with format: 'full'                                  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Storage Layer                                   │
│   Filesystem (scratch)  │  SQLite via memory  │  User filesystem    │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

| Component                     | File                                                            | Responsibility                                             |
| ----------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| Diff Resolver                 | `src/lib/diff-resolver.ts`                                      | Parse/apply unified diffs; expose `resolveContents()`      |
| Update Scratch File Tool      | `src/plugins/system/scratch-files/tools/update-scratch-file.ts` | Unified write/append via diff or full content              |
| Scratch Files Plugin          | `src/plugins/system/scratch-files/scratch-files.ts`             | Remove `appendScratchFile`, register unified tool          |
| Update Proficiency Tool       | (inline in `proficiencies.ts`)                                  | Add `format: full\|diff`; remove `append` flag             |
| Update Personality Facet Tool | (inline in `personality-facets.ts`)                             | Add `format: full\|diff`; remove `appendInstructions` flag |
| Update User Text File Tool    | `src/plugins/system/user-files/tools/update-user-text-file.ts`  | New; scoped permission check on top of write permission    |
| User Files Plugin             | `src/plugins/system/user-files/user-files.ts`                   | Register `updateUserTextFile`                              |
| Tool System Types             | `src/lib/tool-system.ts`                                        | (no changes needed)                                        |

### Data Flow for Diff Format

```
1. Tool receives { filename, format: 'diff', contents: patch }
2. Tool reads existing file/record contents (original)
3. Tool calls diffResolver.resolveContents(original, 'diff', contents)
   - diffResolver parses patch
   - diffResolver applies patch to original
   - Returns new contents string
4. Tool writes new contents to storage
5. Tool returns success message
```

### API Contract: Diff Resolver

```typescript
// src/lib/diff-resolver.ts

export type UpdateFormat = 'full' | 'diff';

/**
 * Result type for resolveContents — distinguishes success from soft errors.
 * A soft error means the operation failed but the caller can inform the LLM
 * and let it retry with format: 'full'.
 */
export type ResolveResult =
  | { ok: true; contents: string }
  | {
      ok: false;
      reason: 'empty_patch' | 'parse_error' | 'apply_error';
      message: string;
    };

/**
 * Resolve new contents from original + update payload.
 * - format 'full': contents is the complete new text, returned as-is
 * - format 'diff': contents is a unified diff patch; applied to original
 *
 * Soft errors (empty patch, parse failure, apply failure) are logged to
 * console and returned as { ok: false, ... } so the tool layer can tell
 * the LLM it "is being dumb" and let it retry.
 *
 * @param original - current contents of the file/record
 * @param format - 'full' (raw) or 'diff' (patch)
 * @param contents - new contents (full) or patch (diff)
 * @returns resolved new contents or soft error
 */
export function resolveContents(
  original: string,
  format: UpdateFormat,
  contents: string
): ResolveResult;
```

---

## New Package Dependencies

| Package | Version  | Rationale                                                                               |
| ------- | -------- | --------------------------------------------------------------------------------------- |
| `diff`  | `^7.0.0` | Unified diff parse and apply; zero-configuration; works in Node ESM; no native bindings |

Verification: [diff on npm](https://www.npmjs.com/package/diff) — v7.0.0 is current stable; ESM-compatible via `module.exports` → `exports` dual mapping; pure JavaScript with no native bindings.

---

## Project Structure

```
src/
├── lib/
│   └── diff-resolver.ts          # NEW: core diff resolution API
├── plugins/
│   ├── system/
│   │   ├── scratch-files/
│   │   │   ├── scratch-files.ts
│   │   │   └── tools/
│   │   │       ├── update-scratch-file.ts  # NEW (replaces write + append)
│   │   │       ├── delete-scratch-file.ts
│   │   │       ├── read-scratch-file.ts
│   │   │       └── list-scratch-files.ts
│   │   ├── proficiencies/
│   │   │   └── proficiencies.ts             # MODIFY: update tool schema + logic
│   │   ├── user-files/
│   │   │   ├── user-files.ts               # MODIFY: register new tool
│   │   │   └── tools/
│   │   │       ├── update-user-text-file.ts # NEW
│   │   │       ├── write-user-text-file.ts
│   │   │       ├── read-user-text-file.ts
│   │   │       └── ...
│   │   └── personality/
│   │       └── personality.ts / facets ts  # (personality-facets is community/)
│   └── community/
│       └── personality-facets/
│           └── personality-facets.ts        # MODIFY: update tool schema + logic
```

### Naming Conventions

- File-based tools: `update-<noun>.ts` (e.g., `update-scratch-file.ts`)
- Schema types: `Update<Noun>ParametersSchema`, `Update<Noun>Parameters`
- Tool names: `updateScratchFile`, `updateProficiency`, `updatePersonalityFacet`, `updateUserTextFile`

---

## Implementation Steps

### Step 1: Install `diff` package

**Action:** Add `diff` to `dependencies` in `package.json`.

**File:** `/home/unleet/Projects/alice-assistant/package.json`

**Details:** Run `npm install diff@^7.0.0` and verify the package is listed.

**Dependencies:** None.

**Complexity:** Low.

---

### Step 2: Create core diff resolver

**Action:** Create `src/lib/diff-resolver.ts` with the `resolveContents()` function.

**File:** `/home/unleet/Projects/alice-assistant/src/lib/diff-resolver.ts`

**Details:**

```typescript
import { diffApplyPatch, parsePatch } from 'diff';

export type UpdateFormat = 'full' | 'diff';

export type ResolveResult =
  | { ok: true; contents: string }
  | {
      ok: false;
      reason: 'empty_patch' | 'parse_error' | 'apply_error';
      message: string;
    };

export function resolveContents(
  original: string,
  format: UpdateFormat,
  contents: string
): ResolveResult {
  if (format === 'full') {
    return { ok: true, contents };
  }

  // format === 'diff'
  if (!contents.trim()) {
    const msg = 'LLM provided an empty diff patch.';
    console.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'empty_patch', message: msg };
  }

  let patches;
  try {
    patches = parsePatch(contents);
  } catch (e) {
    const msg = `LLM generated an unparseable diff: ${e instanceof Error ? e.message : String(e)}`;
    console.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'parse_error', message: msg };
  }

  if (patches.length === 0) {
    const msg = 'LLM provided an empty diff patch.';
    console.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'empty_patch', message: msg };
  }

  // Apply all patches in sequence
  let result = original;
  try {
    for (const patch of patches) {
      result = diffApplyPatch(result, patch);
    }
  } catch (e) {
    const msg = `Diff apply failed: ${e instanceof Error ? e.message : String(e)}`;
    console.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'apply_error', message: msg };
  }

  return { ok: true, contents: result };
}
```

**Dependencies:** None (new file).

**Complexity:** Low.

---

### Step 3: Create `updateScratchFile` tool (replaces write + append)

**Action:** Create `src/plugins/system/scratch-files/tools/update-scratch-file.ts`.

**File:** `/home/unleet/Projects/alice-assistant/src/plugins/system/scratch-files/tools/update-scratch-file.ts`

**Details:**

- Parameter schema: `{ filename: string, format: 'full'|'diff', contents: string }`
- Read existing file if it exists (needed for diff application)
- Call `resolveContents()` with `format` and `contents`
- Apply same validation (path traversal, file type, size, allowOverwrite)
- Write resolved contents to disk
- Return standard success/error message
- `availableFor: ['autonomy', 'chat', 'voice']`

**Dependencies:** Step 1 (diff package), Step 2 (diff-resolver.ts).

**Complexity:** Medium.

---

### Step 4: Update scratch-files plugin to register unified tool

**Action:** In `scratch-files.ts`:

1. Remove import of `appendScratchFileTool`
2. Remove `appendScratchFileTool(...)` from `registerTool` calls
3. Import and register `updateScratchFileTool` instead

**File:** `/home/unleet/Projects/alice-assistant/src/plugins/system/scratch-files/scratch-files.ts`

**Details:** Also update the header system prompt check (line 100) to reference `updateScratchFile` instead of `writeScratchFile`.

**Dependencies:** Step 3 (new tool file).

**Complexity:** Low.

---

### Step 5: Update `updateProficiency` tool schema

**Action:** In `proficiencies.ts`:

1. Replace `UpdateProficiencyParametersSchema` with new schema adding `format: 'full'|'diff'`
2. Remove the `append?: boolean` field
3. Update `execute` to call `resolveContents()` instead of conditional append logic

**File:** `/home/unleet/Projects/alice-assistant/src/plugins/system/proficiencies/proficiencies.ts`

**Details:**

```typescript
// New schema fields:
format: Type.Optional(
  Type.Literal('full', { description: '...' }) ||
  Type.Literal('diff', { description: '...' })
),
contents: Type.Optional(Type.String({ description: 'Updated proficiency contents.' })),
recallWhen: Type.Optional(Type.String({ ... })),
// REMOVE: append: Type.Optional(Type.Boolean({ ... }))
```

**Dependencies:** Step 1 (diff package), Step 2 (diff-resolver.ts).

**Complexity:** Medium.

---

### Step 6: Update `updatePersonalityFacet` tool schema

**Action:** In `personality-facets.ts`:

1. Add `format: 'full'|'diff'` to `UpdatePersonalityFacetToolParametersSchema`
2. Remove `appendInstructions: boolean` field
3. Update `createOrUpdateFacetDefinition()` to use `resolveContents()` for instructions

**File:** `/home/unleet/Projects/alice-assistant/src/plugins/community/personality-facets/personality-facets.ts`

**Details:** The `instructions` field is always provided; `format` determines whether it's raw or a diff patch. When applying a diff, the existing instructions are the "original" for patch application.

**Dependencies:** Step 1 (diff package), Step 2 (diff-resolver.ts).

**Complexity:** Medium.

---

### Step 7: Create `updateUserTextFile` tool

**Action:** Create `src/plugins/system/user-files/tools/update-user-text-file.ts`.

**File:** `/home/unleet/Projects/alice-assistant/src/plugins/system/user-files/tools/update-user-text-file.ts`

**Details:**

- Parameter schema: `{ path: string, format: 'full'|'diff', contents: string }`
- Same path validation as `writeUserTextFile`
- **Permission scoping:** `updateUserTextFile` inherits `allowedFileTypesWrite` from write config, and `allowedFilePaths`. The update operation can be further restricted via a new config field `allowedUpdatePaths: string[]` — if non-empty, the update is only allowed within one of these paths (a subset of `allowedFilePaths`). This enables scenarios like "allow updates to a shared notebook but not new file creation."
- Read existing file, apply diff resolution, write back
- Return JSON result object
- `availableFor: ['chat', 'voice']` (not 'autonomy', matching writeUserTextFile)

**Dependencies:** Step 1 (diff package), Step 2 (diff-resolver.ts).

**Complexity:** Medium.

---

### Step 8: Register `updateUserTextFile` in user-files plugin

**Action:** In `user-files.ts`, import and register the new tool.

**File:** `/home/unleet/Projects/alice-assistant/src/plugins/system/user-files/user-files.ts`

**Details:** Keep existing tools (`writeUserTextFile` remains as-is per requirements).

**Dependencies:** Step 7 (new tool file).

**Complexity:** Low.

---

### Step 10: Update plugins that borrow the affected tools

**Action:** Update plugins that use `addToolToConversationType` to borrow the old tools so they instead borrow the new unified tools.

**Files:**

| File                                                       | Change                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/plugins/community/moltbook-agent/moltbook-agent.ts`   | Change `writeScratchFile` → `updateScratchFile`, `appendScratchFile` → `updateScratchFile` (both borrow the same tool now) |
| `src/plugins/community/obsidian-broker/obsidian-broker.ts` | Change `writeScratchFile` → `updateScratchFile`, `appendScratchFile` → `updateScratchFile`                                 |
| `src/plugins/community/facet-gardener/facet-gardener.ts`   | `updatePersonalityFacet` signature changed; no registration call change needed since the tool name is the same             |
| `src/plugins/community/deep-dive/deep-dive.ts`             | `updateProficiency` signature changed; no registration call change needed since the tool name is the same                  |

**Details:**

- **moltbook-agent** (lines 596–605): The `writeScratchFile` and `appendScratchFile` borrows should both become `updateScratchFile`. Since both old tools are being replaced by the single `updateScratchFile`, the two `addToolToConversationType` calls can be replaced with one call to `updateScratchFile` (or both can stay — the engine will deduplicate, but one call is cleaner).
- **obsidian-broker** (lines 510–524): Same as above — `writeScratchFile` and `appendScratchFile` → `updateScratchFile`.
- **facet-gardener** and **deep-dive**: These borrow `updatePersonalityFacet` and `updateProficiency` respectively — the tool names stay the same, only the parameter schema changes. The `addToolToConversationType` calls themselves don't need updating; the tools will handle `format: full` or `format: diff` at call time.
- Update the scenario prompts/system prompt fragments that mention the old tool names to mention `updateScratchFile` instead.

**Dependencies:** Steps 3, 4, 5, 6 (tools updated).

**Complexity:** Low.

---

### Step 11: Run lint and tests

**Action:**

1. Run `npm run lint` and fix any issues
2. Run `npm test` and fix any failures
3. Specifically test the new diff resolver with unit tests

**Files:** All modified files.

**Details:** Add `src/lib/diff-resolver.test.ts` with tests for:

- `format: 'full'` returns `{ ok: true, contents }`
- `format: 'diff'` with empty original (creates file from patch)
- `format: 'diff'` with existing original (incremental edit)
- `format: 'diff'` with invalid patch → `{ ok: false, reason: 'parse_error', message }`
- `format: 'diff'` with empty patch → `{ ok: false, reason: 'empty_patch', message }`
- `format: 'diff'` with patch apply failure → `{ ok: false, reason: 'apply_error', message }`

**Dependencies:** All previous steps.

**Complexity:** Low.

**Complexity:** Low.

---

## File Changes Summary

| File                                                             | Action     | Description                                                                       |
| ---------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `src/lib/diff-resolver.ts`                                       | **Create** | Core diff resolution API with `ResolveResult` type                                |
| `src/lib/diff-resolver.test.ts`                                  | **Create** | Unit tests for diff resolver                                                      |
| `src/plugins/system/scratch-files/tools/update-scratch-file.ts`  | **Create** | Unified write/append tool replacing writeScratchFile + appendScratchFile          |
| `src/plugins/system/scratch-files/scratch-files.ts`              | **Modify** | Register unified tool, remove appendScratchFile import and registration           |
| `src/plugins/system/proficiencies/proficiencies.ts`              | **Modify** | Add format param, remove append flag, use resolveContents()                       |
| `src/plugins/community/personality-facets/personality-facets.ts` | **Modify** | Add format param, remove appendInstructions flag, use resolveContents()           |
| `src/plugins/system/user-files/tools/update-user-text-file.ts`   | **Create** | New update tool with `allowedUpdatePaths` scoping                                 |
| `src/plugins/system/user-files/user-files.ts`                    | **Modify** | Register updateUserTextFile; add `allowedUpdatePaths` to config schema            |
| `src/plugins/community/moltbook-agent/moltbook-agent.ts`         | **Modify** | Replace `writeScratchFile` + `appendScratchFile` borrows with `updateScratchFile` |
| `src/plugins/community/obsidian-broker/obsidian-broker.ts`       | **Modify** | Replace `writeScratchFile` + `appendScratchFile` borrows with `updateScratchFile` |
| `package.json`                                                   | **Modify** | Add `diff@^7.0.0` dependency                                                      |

---

## Testing Strategy

### Unit Tests

| File                                                                 | What to Test                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/lib/diff-resolver.test.ts`                                      | `resolveContents()` with `format: full`, `format: diff`; patch parsing; error handling |
| `src/plugins/system/scratch-files/tools/update-scratch-file.test.ts` | Tool execution (mock fs); diff vs full mode                                            |
| `src/plugins/system/user-files/tools/update-user-text-file.test.ts`  | Tool execution (mock fs); diff vs full mode                                            |

### Manual Testing Steps

1. **Scratch file diff update:**
   - Write a scratch file with `updateScratchFile(format: 'full', contents: 'Hello World')`
   - Update it with `updateScratchFile(format: 'diff', contents: '--- original\n+++ modified\n@@ -1 +1 @@\n-Hello World\n+Hello World!')`
   - Verify file contains `Hello World!`

2. **Proficiency diff update:**
   - Create a proficiency
   - Update it with a diff patch to add a line
   - Verify the append behavior matches the old `append: true` behavior

3. **Personality facet diff update:**
   - Create a facet
   - Update it with a diff to modify instructions
   - Verify instructions reflect the patch application

4. **User text file update:**
   - Write a file with `writeUserTextFile`
   - Update with `updateUserTextFile(format: 'diff', ...)`
   - Verify file reflects the patch

---

## Definition of Done

- [ ] `npm install diff@^7.0.0` succeeds
- [ ] `src/lib/diff-resolver.ts` exports `resolveContents(original, format, contents)` returning `ResolveResult`
- [ ] `resolveContents()` with `format: 'full'` returns `{ ok: true, contents: contents }`
- [ ] `resolveContents()` with `format: 'diff'` parses and applies unified patch to original
- [ ] Soft errors (empty patch, parse error, apply error) return `{ ok: false, reason, message }` with console warning
- [ ] `updateScratchFile` tool registered with `{ filename, format: 'full'|'diff', contents }` parameters
- [ ] `appendScratchFile` tool is no longer registered
- [ ] `updateProficiency` tool accepts `format: 'full'|'diff'` (no `append` flag)
- [ ] `updatePersonalityFacet` tool accepts `format: 'full'|'diff'` (no `appendInstructions` flag)
- [ ] `updateUserTextFile` tool exists with `allowedUpdatePaths` config field and is registered
- [ ] `writeUserTextFile` remains unchanged (not an update target)
- [ ] `npm run lint` passes with no errors
- [ ] `npm test` passes with no failures
- [ ] All tool parameter schemas use Typebox `Type.Literal()` for format enum
- [ ] All imports use explicit `.js` extensions
- [ ] `diff` package imported with `import { diffApplyPatch, parsePatch } from 'diff'`
- [ ] `moltbook-agent` uses `updateScratchFile` (not `writeScratchFile` + `appendScratchFile`) in `addToolToConversationType` calls
- [ ] `obsidian-broker` uses `updateScratchFile` (not `writeScratchFile` + `appendScratchFile`) in `addToolToConversationType` calls
- [ ] Scenario prompts in affected plugins mention `updateScratchFile` instead of the old tool names

---

## Risks & Mitigations

| Risk                                                                   | Impact                                        | Mitigation                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LLM generates malformed diff that `diff` package cannot parse          | Soft error; LLM told to retry with `full`     | `resolveContents()` returns `{ ok: false, reason: 'parse_error' }` with console warning; tool returns message telling the LLM it "is being dumb" and to retry.                                         |
| Patch application produces unexpected result (e.g., hunk offset drift) | Soft error; LLM told to retry with `full`     | `resolveContents()` returns `{ ok: false, reason: 'apply_error' }` with console warning; tool returns message. Enforce size limits before write.                                                       |
| Empty diff patch                                                       | Soft error; LLM told to use proper intent     | `resolveContents()` returns `{ ok: false, reason: 'empty_patch' }` with console warning; tool returns message telling the LLM to be explicit.                                                          |
| Removing `append` flag is a breaking change for callers                | Existing code that uses `append: true` breaks | This is an intentional breaking change per requirements. Deprecation warning not needed since nothing external currently uses these tools.                                                             |
| Diff package has vulnerabilities                                       | Security risk                                 | `diff` is a mature, widely-used package with no native bindings. Monitor `npm audit`.                                                                                                                  |
| Large diff patches exceed size limits                                  | Tool returns size error                       | Size limits are applied to the _patch_ contents, not the result. A large change as a full replacement would also exceed limits. The LLM should be prompted to use `format: 'full'` for large rewrites. |

---

## Timeline Estimate

**Assumptions:**

- The `diff` package API is straightforward (parse + apply)
- Existing tool validation logic is preserved (no redesign)
- No changes to config schemas or plugin interfaces

**Estimated Total:** 5–7 hours

- Step 1 (install): 5 min
- Step 2 (diff resolver): 30 min
- Step 3 (updateScratchFile tool): 45 min
- Step 4 (plugin update): 15 min
- Step 5 (proficiencies): 45 min
- Step 6 (personality facets): 45 min
- Step 7 (updateUserTextFile): 45 min
- Step 8 (register in user-files): 15 min
- Step 9 (lint + tests): 30 min
- Step 10 (borrowing plugins): 30 min
