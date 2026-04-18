# Implementation Plan: Available Tools in DynamicPromptContext

## Overview

Add an `availableTools` array (tool names) to `DynamicPromptContext` so that prompts registered by plugins like `memory`, `proficiencies`, `skills`, and others can imperatively check whether their referenced tools are actually available for the current conversation before including text that directs the LLM to use those tools. This prevents misleading prompt context — e.g., the deep-dive research agent seeing "Use the recallPastConversations tool" when that tool is not wired into its conversation type.

## Requirements Summary

- **Functional**: `DynamicPromptContext` must carry an `availableTools: string[]` field containing the names of all tools available for the current conversation type (as returned by `getTools(conversationType).map(t => t.name)`).
- **Gating**: Plugin `getPrompt` functions should be able to check `context.availableTools.includes('someToolName')` and return `false` when the tool is not available.
- **Scope**: Only imperative (each `getPrompt` checks as needed). No new `requiresTools` declarative field on `DynamicPrompt`.
- **No taint filtering**: `availableTools` reflects the registered tool set for the conversation type, not the taint-filtered set.
- **No changes** to `toolsHeader` or `scenarioHeader` prompts — those handle themselves via direct `getTools()` calls.

## Architecture & Design

### Data Flow

```
conversation.ts (sendUserMessage / handleToolCalls)
  │
  ├── getTools(this.type) → Tool[]
  │     └── .map(t => t.name) → availableTools: string[]
  │
  ├── getHeaderPrompts({ ..., availableTools })
  │     └── processDynamicPrompts(context, prompts)
  │           └── each prompt.getPrompt(context) → checks context.availableTools as needed
  │
  └── getFooterPrompts({ ..., availableTools })
        └── processDynamicPrompts(context, prompts)
              └── each prompt.getPrompt(context) → checks context.availableTools as needed
```

### Key Design Decisions

1. **`availableTools` is computed from `getTools(conversationType)`**, not from `buildOllamaToolDescriptionObject()`. Taint filtering is intentionally excluded — this is about structural availability (is the tool registered for this conversation type?), not runtime security.
2. **Imperative only** — no new fields on `DynamicPrompt`. Each plugin's `getPrompt` checks `context.availableTools` itself. This keeps the type simple and avoids semantic questions (AND vs OR for multi-tool prompts).
3. **Backwards compatible** — `availableTools` is optional in `DynamicPromptContext` so no existing consumers break. New conversations always populate it.

## Implementation Steps

### Step 1: Add `availableTools` to `DynamicPromptContext`

Add the new optional field to the type.

**File:** `src/lib/dynamic-prompt.ts`

```typescript
export type DynamicPromptContext = {
  conversationType: DynamicPromptConversationType;
  sessionId?: number;
  toolCallsAllowed?: boolean;
  /** Set when this context is for a task assistant conversation. */
  taskAssistantId?: string;
  /** Names of tools available for the current conversation type. */
  availableTools?: string[];
};
```

**Complexity:** Low

### Step 2: Populate `availableTools` in `conversation.ts`

In both `sendUserMessage` and `handleToolCalls`, compute the available tool names and include them in the context objects passed to `getHeaderPrompts` and `getFooterPrompts`.

**File:** `src/lib/conversation.ts`

In `sendUserMessage()` (currently lines 303-314):

```typescript
const availableTools = getTools(this.type).map(t => t.name);

const headerPrompts = await getHeaderPrompts({
  conversationType: this.type,
  sessionId: this.sessionId,
  taskAssistantId: this.taskAssistantId,
  toolCallsAllowed: true,
  availableTools,
});

const footerPrompts = await getFooterPrompts({
  conversationType: this.type,
  sessionId: this.sessionId,
  taskAssistantId: this.taskAssistantId,
  availableTools,
});
```

In `handleToolCalls()` (currently lines 388-415), same pattern for both footer and header contexts:

```typescript
const availableTools = getTools(this.type).map(t => t.name);

const footerPrompts = await getFooterPrompts({
  conversationType: this.type,
  sessionId: this.sessionId,
  taskAssistantId: this.taskAssistantId,
  availableTools,
});

// ... later ...

const headerPrompts = await getHeaderPrompts({
  conversationType: this.type,
  sessionId: this.sessionId,
  taskAssistantId: this.taskAssistantId,
  toolCallsAllowed: callsStillAllowed,
  availableTools,
});
```

Note: `getTools` is already imported in `conversation.ts` (line 8).

**Complexity:** Low

### Step 3: Gate `memory` header prompt on `recallPastConversations` availability

The memory header prompt references the `recallPastConversations` tool. If that tool is not available for the current conversation type, the prompt should be suppressed.

**File:** `src/plugins/system/memory/memory.ts`

In the `memoryHeader` `getPrompt` function (currently starting at line 316), add a check after the `startup` guard:

```typescript
getPrompt: async (context): Promise<string | false> => {
  if (context.conversationType === 'startup') {
    return false;
  }

  if (!context.availableTools?.includes('recallPastConversations')) {
    return false;
  }

  // ... rest of existing logic
},
```

**Complexity:** Low

### Step 4: Gate `proficiencies` header prompt on `recallProficiency` availability

The proficiencies header prompt lists proficiencies and tells the LLM to recall them. It only makes sense if `recallProficiency` is available.

**File:** `src/plugins/system/proficiencies/proficiencies.ts`

In the header `getPrompt` (currently starting at line 379), add a check:

```typescript
getPrompt: async context => {
  if (context.conversationType === 'startup') {
    return false;
  }

  if (!context.availableTools?.includes('recallProficiency')) {
    return false;
  }

  // ... rest of existing logic
},
```

**Complexity:** Low

### Step 5: Gate `proficiencies` footer prompt on `recallProficiency` or `updateProficiency` availability

The footer prompt says "Don't forget to update any applicable proficiencies." This is only actionable if at least one proficiency tool (`recallProficiency` or `updateProficiency`) is available.

**File:** `src/plugins/system/proficiencies/proficiencies.ts`

In the footer `getPrompt` (currently starting at line 418):

```typescript
getPrompt: async context => {
  if (context.conversationType === 'startup') {
    return false;
  }

  const tools = context.availableTools ?? [];
  if (!tools.includes('recallProficiency') && !tools.includes('updateProficiency')) {
    return false;
  }

  return (
    `Don't forget to update any applicable proficiencies if you've just discovered ` +
    `any new information relevant to them.`
  );
},
```

**Complexity:** Low

### Step 6: Gate `skills` header prompt on `recallSkill` availability

The skills header prompt lists skills and tells the LLM to recall them. It only makes sense if `recallSkill` is available.

**File:** `src/plugins/system/skills/skills.ts`

In the `getPrompt` (currently starting at line 123):

```typescript
getPrompt: context => {
  if (context.conversationType === 'startup') {
    return false;
  }

  if (!context.availableTools?.includes('recallSkill')) {
    return false;
  }

  if (skillsRegistry.length === 0) {
    return false;
  }

  // ... rest of existing logic
},
```

**Complexity:** Low

### Step 7: Gate `troubleshooting` footer prompt on `getAssistantDebugInfo` availability

The troubleshooting footer references `getAssistantDebugInfo` by name.

**File:** `src/plugins/system/troubleshooting/troubleshooting.ts`

In the footer `getPrompt` (currently line 54):

```typescript
getPrompt: (context) => {
  if (!context.availableTools?.includes('getAssistantDebugInfo')) {
    return false;
  }

  return (
    'If you are experiencing issues, you can use the "getAssistantDebugInfo" tool ' +
    "to get more information about your assistant's configuration and loaded plugins. This " +
    'information can be helpful for troubleshooting and debugging.\n\n' +
    'If you have access to the internet, you can also reference the file at ' +
    'https://raw.githubusercontent.com/jay-depot/alice-assistant/main/ALICE.md for information ' +
    'that may help you help your user.'
  );
},
```

**Complexity:** Low

### Step 8: Gate `notifications-chat-segue` header prompt on `markNotificationsDelivered` availability

The notification header references the `markNotificationsDelivered` tool.

**File:** `src/plugins/system/notifications-chat-segue/notifications-chat-segue.ts`

In the header `getPrompt` (currently line 66), add after the existing `chat` check:

```typescript
getPrompt: async context => {
  if (context.conversationType !== 'chat') {
    return false;
  }

  if (!context.availableTools?.includes('markNotificationsDelivered')) {
    return false;
  }

  // ... rest of existing logic
},
```

**Complexity:** Low

### Step 9: Gate `scratch-files` header prompt on scratch file tool availability

The scratch files header shows the index of scratch files and implicitly expects the scratch file tools to be usable.

**File:** `src/plugins/system/scratch-files/scratch-files.ts`

In the header `getPrompt` (currently line 85), add after the startup guard:

```typescript
async getPrompt(context) {
  const conversationTypeDefinition = getConversationTypeDefinition(
    context.conversationType
  );
  if (
    !conversationTypeDefinition ||
    conversationTypeDefinition.baseType === 'startup'
  ) {
    return false;
  }

  if (!context.availableTools?.some(t => t === 'readScratchFile' || t === 'writeScratchFile')) {
    return false;
  }

  // ... rest of existing logic
},
```

**Complexity:** Low

### Step 10: Update existing tests for `processDynamicPrompts`

Add tests that verify the `availableTools` field is passed through to `getPrompt` functions.

**File:** `src/lib/dynamic-prompt.test.ts`

Add a test:

```typescript
it('passes availableTools through to getPrompt', async () => {
  const received: DynamicPromptContext[] = [];
  const prompts: DynamicPrompt[] = [
    {
      weight: 1,
      name: 'spy',
      getPrompt: ctx => {
        received.push(ctx);
        return 'ok';
      },
    },
  ];
  const contextWithTools: DynamicPromptContext = {
    conversationType: 'chat',
    availableTools: ['recallSkill', 'recallProficiency'],
  };
  await processDynamicPrompts(contextWithTools, prompts);
  expect(received[0].availableTools).toEqual([
    'recallSkill',
    'recallProficiency',
  ]);
});

it('allows getPrompt to use availableTools for gating', async () => {
  const prompts: DynamicPrompt[] = [
    {
      weight: 1,
      name: 'gated',
      getPrompt: ctx =>
        ctx.availableTools?.includes('recallSkill') ? 'visible' : false,
    },
  ];
  const withTool: DynamicPromptContext = {
    conversationType: 'chat',
    availableTools: ['recallSkill'],
  };
  const withoutTool: DynamicPromptContext = {
    conversationType: 'chat',
    availableTools: [],
  };
  expect(await processDynamicPrompts(withTool, prompts)).toEqual(['visible']);
  expect(await processDynamicPrompts(withoutTool, prompts)).toEqual([]);
});
```

**Complexity:** Low

### Step 11: Run linter and full test suite

After all changes, verify nothing is broken.

```bash
npm run lint
npm test
```

**Complexity:** Low

## File Changes Summary

| File                                                                      | Action | Description                                                                                   |
| ------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `src/lib/dynamic-prompt.ts`                                               | Modify | Add `availableTools?: string[]` to `DynamicPromptContext` type                                |
| `src/lib/conversation.ts`                                                 | Modify | Compute and pass `availableTools` in `sendUserMessage` and `handleToolCalls`                  |
| `src/plugins/system/memory/memory.ts`                                     | Modify | Gate `memoryHeader` on `recallPastConversations` availability                                 |
| `src/plugins/system/proficiencies/proficiencies.ts`                       | Modify | Gate header on `recallProficiency`; gate footer on `recallProficiency` or `updateProficiency` |
| `src/plugins/system/skills/skills.ts`                                     | Modify | Gate header on `recallSkill` availability                                                     |
| `src/plugins/system/troubleshooting/troubleshooting.ts`                   | Modify | Gate footer on `getAssistantDebugInfo` availability                                           |
| `src/plugins/system/notifications-chat-segue/notifications-chat-segue.ts` | Modify | Gate header on `markNotificationsDelivered` availability                                      |
| `src/plugins/system/scratch-files/scratch-files.ts`                       | Modify | Gate header on `readScratchFile` or `writeScratchFile` availability                           |
| `src/lib/dynamic-prompt.test.ts`                                          | Modify | Add tests for `availableTools` pass-through and gating                                        |

## Plugins NOT Gated (and Why)

| Plugin                | Prompt        | Reason for Exclusion                                                                                                                      |
| --------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `personality`         | header        | No tool reference in prompt text                                                                                                          |
| `personality-facets`  | header/footer | Prompts don't reference the facet tools by name                                                                                           |
| `system-info`         | header        | Informational; no tool reference                                                                                                          |
| `mood`                | footer        | Footer describes mood concept; `setMood` tool is described via its own `systemPromptFragment` in the tools header, not in the mood footer |
| `deep-dive`           | footer        | Already gated by `conversationType === 'deep-dive-research'`                                                                              |
| `credential-clapback` | footer        | Security notice; no tool reference                                                                                                        |
| `datetime`            | footer        | Informational; no tool reference                                                                                                          |
| `location-broker`     | footer        | Informational; no tool reference                                                                                                          |

## Testing Strategy

### Unit Tests

- **`src/lib/dynamic-prompt.test.ts`**: Verify `availableTools` is passed through `processDynamicPrompts` to `getPrompt`, and that prompts can use it for gating (returning `false` when a tool is missing).
- **Existing prompt tests**: Run full suite to confirm no regressions. The `availableTools` field is optional, so prompts that don't check it are unaffected.

### Integration Tests

- **Deep-dive scenario**: Start a `deep-dive-research` conversation, verify the `memoryHeader` prompt is NOT included in the assembled context (since `recallPastConversations` is not available for `deep-dive-research`).
- **Standard chat scenario**: Verify the `memoryHeader` prompt IS included in a `chat` conversation when memories exist (since `recallPastConversations` IS available for `chat`).

### Manual Testing Steps

1. Start the assistant and have a `chat` conversation — verify memory, skills, and proficiencies headers appear normally.
2. Trigger a deep-dive research agent — inspect the logs or debug output to confirm the `memoryHeader` prompt is absent from the agent's context.
3. Disable the `memory` plugin (or a tool-providing plugin) and verify that its linked prompts are also suppressed.
4. Enable the `troubleshooting` plugin for a conversation type where `getAssistantDebugInfo` is not wired in — verify the footer prompt is suppressed.

## Definition of Done

- [ ] `DynamicPromptContext` has an optional `availableTools?: string[]` field
- [ ] Both `sendUserMessage` and `handleToolCalls` in `conversation.ts` populate `availableTools` from `getTools(this.type).map(t => t.name)`
- [ ] `memory` header prompt returns `false` when `recallPastConversations` is not in `availableTools`
- [ ] `proficiencies` header prompt returns `false` when `recallProficiency` is not in `availableTools`
- [ ] `proficiencies` footer prompt returns `false` when neither `recallProficiency` nor `updateProficiency` is in `availableTools`
- [ ] `skills` header prompt returns `false` when `recallSkill` is not in `availableTools`
- [ ] `troubleshooting` footer prompt returns `false` when `getAssistantDebugInfo` is not in `availableTools`
- [ ] `notifications-chat-segue` header prompt returns `false` when `markNotificationsDelivered` is not in `availableTools`
- [ ] `scratch-files` header prompt returns `false` when neither `readScratchFile` nor `writeScratchFile` is in `availableTools`
- [ ] Unit tests added for `availableTools` pass-through and imperative gating
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] A `deep-dive-research` conversation does NOT include the `memoryHeader` prompt in its context

## Risks & Mitigations

| Risk                                                                                        | Impact                                                                     | Mitigation                                                                                         |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Plugin authors forget to gate their prompts on tool availability                            | Low — same status quo as today, no worse                                   | Document the pattern; `availableTools` at least makes it _possible_ to gate (currently impossible) |
| `availableTools` becomes stale if tools are added/removed mid-conversation                  | Low — tools are registered at plugin load time and don't change at runtime | No mitigation needed; tool registration is frozen after `onAllPluginsLoaded`                       |
| Adding `availableTools` to context increases coupling between prompt system and tool system | Low — it's a read-only snapshot; prompts can ignore it                     | The field is optional; existing prompts still work unchanged                                       |
| Some future plugin may need taint-aware tool availability                                   | Low — taint filtering is a runtime concern per-tool-call                   | Could add `effectiveAvailableTools` later if needed; YAGNI for now                                 |

## Timeline Estimate

~1–2 hours. All changes are localized additions — one type field, two call sites populating it, and ~7 plugins adding a single `if` guard. No architectural refactor required. The largest time investment is running and verifying the test suite.
