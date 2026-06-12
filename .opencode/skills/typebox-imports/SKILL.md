---
name: typebox-imports
description: Use when importing Typebox in any Alice plugin or core module. Trigger phrases: "import Typebox", "Typebox schema", "Type.Object", "Type.String", "Type.Number", "typebox import".
---

# Typebox Import Convention

The project uses two import styles for Typebox. Both are valid, but the **default import** is the prevailing convention.

## Preferred Style

```typescript
import Type from 'typebox';
```

This is used by the majority of plugins (skills, moltbook tools, obsidian-broker, personality-facets, google-apis, news-broker, notifications-chat-segue, static-location, troubleshooting, and more). Use `Type.Object()`, `Type.String()`, `Type.Number()`, etc.

## Also Valid

```typescript
import { Type } from 'typebox';
```

Used by some plugins (mood, voice, system-info, user-files, scratch-files, moltbook, agents, brainstorm, deep-dive, and others). Functionally identical.

## When Editing Existing Files

**If you are already modifying a file that uses `import { Type } from 'typebox'`, update it to `import Type from 'typebox'`** as part of your changes. This helps converge the codebase toward a single convention.

## When Creating New Files

Always use `import Type from 'typebox'` in new plugin or module files.
