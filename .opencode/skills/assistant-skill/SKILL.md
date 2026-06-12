---
name: skills-plugin
description: Use when registering a new assistant skill for the Alice project's skills plugin. Also use when implementing a feature with complex tools that require detailed instructions or workflows. Trigger phrases: "register a skill", "new skill", "skill file", "registerSkill", "registerSkillFile", "SKILL.md for Alice", "add a skill to the assistant".
---

# Registering Assistant Skills

The `skills` plugin (`src/plugins/system/skills/skills.ts`) is a registry for **static**, reusable knowledge snippets that the assistant can recall at runtime. Skills are text or markdown documents containing domain-specific instructions, workflows, conventions, or reference material. They are registered once by a plugin at startup and never change — the assistant retrieves them on demand via the `recall` tool.

Skills are **not** the same as proficiencies. Skills are fixed or deterministically generated, plugin-provided knowledge. Proficiencies are dynamic, assistant-managed knowledge that the assistant creates and updates itself over time. When a skill covers a topic where knowledge is expected to grow or change, the skill body should instruct the assistant to create or recall a relevant proficiency and it should specify the exact name to use for that proficiency.

## Registration Paths

There are two ways to register a skill:

### 1. File-based (preferred for plugin-shipped skills)

Place a `.md` file in your plugin's directory (conventionally under a `skills/` subdirectory) and call `registerSkillFile()` during plugin registration:

```typescript
const skillsApi = plugin.request('skills');
if (!skillsApi) {
  throw new Error(
    'MyPlugin could not access the skills plugin API. ' +
      'Disable my-plugin or enable skills to recover.'
  );
}
skillsApi.registerSkillFile(
  path.join(import.meta.dirname, 'skills', 'MySkill.md')
);
```

The `skills` plugin reads the file, parses the JSON metadata block, and registers the skill. This keeps the skill content in a standalone markdown file that's easy to read and maintain.

### 2. Programmatic

Call `registerSkill()` directly with a `RegisteredSkill` object:

```typescript
const skillsApi = plugin.request('skills');
skillsApi.registerSkill({
  id: 'my-skill',
  recallWhen: 'the user asks about topic X',
  contents: 'Detailed instructions for handling topic X...',
});
```

Prefer file-based registration for anything longer than a few lines. Programmatic registration is useful for small, inline skills or dynamically generated content.

## Skill File Format

A skill file is a `.md` file with a **JSON metadata block** at the top, followed by a `---` separator, then the markdown body:

```
{ "id": "my-skill", "recallWhen": "the user asks about X" }
---

# My Skill

(skill body in markdown)
```

**Required metadata fields:**

- `id` — a unique string identifier for the skill. Must be unique across all registered skills. Use a descriptive, kebab-case or PascalCase name. Plugin-shipped skills often use a simple capitalized name (e.g. `"Moltbook"`, `"Proficiencies"`, `"Teach"`).
- `recallWhen` — a fragment that completes the imperative: "Recall this skill when...". This is displayed to the assistant in the header system prompt so it knows when to fetch the full skill contents. Be concise but specific. Examples: `"you are about to call any of the following tools: recallProficiency, createProficiency..."`, `"you are about to talk about your activities on, or interact with Moltbook"`, `"the user asks to learn something, set up a lesson plan, or return to an ongoing lesson"`.

**Optional metadata fields:**

- `comment` — ignored by the `skills` plugin core. Use for attribution, provenance notes, or internal documentation. Convention established by the `teach` plugin. Example: `"comment": "Port of Matt Pocock's 'teach' skill, adapted for the A.L.I.C.E. Assistant plugin ecosystem."`

The `---` separator splits the JSON metadata from the body. Only the first `---` is used as the delimiter — subsequent `---` strings in the body are preserved as literal content.

## Writing the Body

The body is freeform markdown containing:

- Instructions for how the assistant should perform the task
- Code patterns and examples
- Relevant file paths, plugin IDs, and tool names
- Any constraints or "never do this" rules
- References to related skills or proficiencies the assistant should also recall

Use fenced code blocks with the appropriate language (`typescript`, `json`, `bash`, etc.).

Write instructions in **second person** ("you") — the assistant is the audience. Be direct and actionable. Prefer affirmative instructions over "don't" and "never" statements where possible.

If the skill covers a topic where knowledge is expected to accumulate or change over time, include instructions telling the assistant to create or recall a relevant proficiency. For example, the `Proficiencies` skill itself teaches the assistant how and when to create its own proficiencies. If your skill instructs the assistant to create or recall proficiencies, you should specify their exact names wherever possible, and establish a clear naming pattern otherwise.

## Example

Here is a real skill file from the `teach` plugin (`src/plugins/system/teach/teach-skill.md`):

```
{ "id": "Proficiencies",
"recallWhen": "the user asks to learn something, set up a lesson plan, or return to an ongoing lesson",
"comment": "Port of Matt Pocock's 'teach' skill, adapted for the A.L.I.C.E. Assistant plugin ecosystem." }

---

# Teach Skill

You are in teaching mode. The user has asked you to teach them something.
This is a stateful request — they intend to learn the topic over multiple
sessions. All teaching state is persisted in the assistant's database via
the teach plugin's tools.

## Teaching Workspace

The state of the user's learning is stored in the database and accessed
through tools. You manage several types of artifacts:

- **Topic**: The top-level container for everything about one subject.
  Use `teach.list_topics` to see existing topics and `teach.create_topic`
  to start a new one.
- **Mission**: Captures the _reason_ the user is interested in the topic.
  (...)
```

This example demonstrates the JSON metadata block, the `---` separator, the optional `comment` field, and a body written in second person with concrete tool names and workflows.

## How Registration Works

### The `recall` tool

The `skills` plugin registers a tool called `recall` (available for `chat`, `voice`, and `autonomy` by default, and may be "borrowed" into other conversation types at plugin registration). The assistant calls it with a `skillId` parameter to fetch the full contents of a registered skill. If the skill ID isn't found, the tool returns an error message.

### The header system prompt

The `skills` plugin also registers a header system prompt (weight 50) that lists every registered skill by ID along with its `recallWhen` condition:

```
Recall any appropriate skills proactively whenever you judge them
relevant to the current task or topic.
You have the following skills available:

- **Moltbook:** recall Moltbook when you are about to talk about your
  activities on, or interact with Moltbook
- **Proficiencies:** recall Proficiencies when you are about to call
  any of the following tools: recallProficiency, createProficiency...
```

This prompt is suppressed during `startup` conversations and when the `skills.recall` tool isn't available. The assistant uses these summaries to decide when to call `recall` for the full skill contents.

### Plugin dependency

Plugins that register skills must declare a dependency on `skills` in their `pluginMetadata.dependencies`:

```typescript
pluginMetadata: {
  // ...
  dependencies: [{ id: 'skills', version: 'LATEST' }],
}
```

Then request the API during registration:

```typescript
const skillsApi = plugin.request('skills');
if (!skillsApi) {
  throw new Error(
    'MyPlugin could not access the skills plugin API. ' +
      'Disable my-plugin or enable skills to recover.'
  );
}
skillsApi.registerSkillFile(
  path.join(import.meta.dirname, 'skills', 'MySkill.md')
);
```

## Programmatic Registration

For inline or dynamically generated skills, use `registerSkill()` directly.

Then call it inside `registerPlugin()`:

```typescript
const { registerSkill } = plugin.request('skills');
registerSkill({
  id: 'my-plugin/special-skill',
  recallWhen: 'the user asks about topic X',
  contents: 'Detailed instructions for handling topic X...',
});
```

Skill IDs must be unique across all plugins. The `skills` plugin throws if a duplicate ID is registered.

## When to Create a Skill

Create a skill when:

- A plugin needs to teach the assistant domain-specific knowledge or multi-step workflows
- The same instructions would otherwise be repeated across multiple system prompts or tools
- A feature has non-obvious patterns, conventions, or tool interactions that are hard to discover
- You want the assistant to follow a specific process that involves multiple tools

For short, simple, unchanging conventions (e.g. "always link to sources when presenting news"), add them to the system prompts directly, using `plugin.registerHeaderSystemPrompt()` or `plugin.registerFooterSystemPrompt()`.

## Skills vs. Proficiencies

|                      | Skills                                                     | Proficiencies                                              |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| **Who creates them** | Plugin developers                                          | The assistant itself                                       |
| **When**             | At plugin registration (startup)                           | At runtime, during conversations                           |
| **Mutability**       | Static — fixed at registration time                        | Dynamic — the assistant creates, updates, and deletes them |
| **Storage**          | In plugin source or skill files                            | In the database (via the `memory` plugin)                  |
| **Purpose**          | Teach the assistant how to use a plugin's tools and domain | Let the assistant build up knowledge from experience       |

**When a skill should reference proficiencies:** If your skill covers a topic where knowledge is expected to grow, change, or be personalized to the user, include instructions telling the assistant to create or recall a proficiency. For example, the `Proficiencies` skill (shipped by the `proficiencies` plugin) is itself a skill that teaches the assistant how and when to create its own proficiencies. A `Moltbook` skill might tell the assistant to create a proficiency for tracking which other AIs it has interacted with and what it learned from them.

The `proficiencies` plugin must be enabled for the assistant to use proficiencies. If your skill references proficiencies, consider making the `proficiencies` plugin a hard dependency.
