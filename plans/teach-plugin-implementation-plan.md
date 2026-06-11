# Implementation Plan: Teach Plugin

## Overview

Port the [mattpocock/skills `teach` skill](https://github.com/mattpocock/skills/tree/main/skills/productivity/teach) to an A.L.I.C.E. Assistant system plugin. The original skill is a stateful, multi-session teaching workspace that uses filesystem files to track a learner's mission, glossary, resources, learning records, lessons, and notes. This port replaces the filesystem workspace with database-backed persistence via the `memory` plugin, serves lesson HTML through REST endpoints via `rest-serve`, and registers a recallable assistant skill through the `skills` plugin so the assistant can invoke the teaching workflow on demand.

Credit to the original: this plugin is a port of Matt Pocock's excellent `teach` skill from [mattpocock/skills](https://github.com/mattpocock/skills), adapted for the A.L.I.C.E. Assistant plugin ecosystem.

## Requirements Summary

### Functional

- Support **multiple concurrent teaching topics**, each with its own mission, glossary, resources, learning records, lessons, reference documents, and notes.
- The assistant can create, read, update, and delete all teaching workspace artifacts through registered tools.
- Lessons are stored as HTML in the database and served via REST endpoints so the user can open them in a browser.
- A recallable skill is registered with the `skills` plugin so the assistant can invoke the full teaching workflow when the user asks to learn something.
- The assistant can determine the learner's zone of proximal development by reading learning records.
- Glossary terms are opinionated, compressed definitions that the assistant curates as the user demonstrates understanding.
- Learning records follow the ADR-like format from the original: numbered, with optional status/evidence/implications sections.
- Lessons are self-contained HTML files with clean typography, citations, and links to other lessons and reference documents.

### Non-Functional

- All persistent state lives in the SQLite database via the `memory` plugin — no filesystem workspace directories.
- Plugin is a **system** plugin (`required: false`, disabled by default) per the local-first philosophy.
- Follows all A.L.I.C.E. plugin conventions: Typebox schemas for tool parameters and config, `offer()`/`request()` for inter-plugin APIs, lifecycle hook logging with brand color prefix.
- Lesson HTML is served through `rest-serve` Express routes, not WebSocket.
- Entity table names are prefixed with `Teach` (PascalCase of plugin id `teach`).

## Architecture & Design

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      teach plugin                           │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  DB Entities  │  │  REST Routes │  │  Assistant Skill │  │
│  │              │  │              │  │  (via skills)     │  │
│  │ TeachTopic   │  │ GET /api/    │  │                  │  │
│  │ TeachMission │  │   teach/     │  │  "teach" skill   │  │
│  │ TeachGlossary│  │   :topicId/  │  │  registered at   │  │
│  │ TeachResource│  │   lessons/   │  │  startup         │  │
│  │ TeachLearnRec│  │   :lessonId  │  │                  │  │
│  │ TeachLesson  │  │              │  │                  │  │
│  │ TeachRefDoc  │  │ GET /api/    │  │                  │  │
│  │ TeachNote    │  │   teach/     │  │                  │  │
│  │              │  │   :topicId/  │  │                  │  │
│  │              │  │   reference/ │  │                  │  │
│  │              │  │   :refId     │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
└─────────┼─────────────────┼────────────────────┼────────────┘
          │                 │                    │
          ▼                 ▼                    ▼
   ┌──────────┐    ┌──────────────┐    ┌──────────────┐
   │  memory  │    │  rest-serve  │    │    skills    │
   │ (SQLite) │    │  (Express)   │    │  (registry)  │
   └──────────┘    └──────────────┘    └──────────────┘
```

### Component Breakdown

| Component            | Responsibility                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `teach.ts`           | Plugin entry point: registers entities, tools, REST routes, skill, and config                  |
| `db-schemas/`        | MikroORM entity definitions for all 7 workspace artifact types                                 |
| `teach-skill.md`     | The skill content registered with `skills`, containing the full teaching workflow instructions |
| `lesson-template.ts` | Generates the HTML wrapper for lessons (Tufte-style typography, navigation, citations)         |
| `teach.test.ts`      | Unit and integration tests                                                                     |

### Data Models

All entities use the `defineEntity` pattern and are registered with `memory` via `registerDatabaseModels()`. Table names are prefixed with `Teach`.

#### `TeachTopic` — the top-level container

```typescript
// db-schemas/TeachTopic.ts
const TeachTopicSchema = defineEntity({
  name: 'TeachTopic',
  properties: {
    id: p.integer().primary(),
    slug: p.string(), // URL-safe kebab-case identifier, unique
    name: p.string(), // Human-readable topic name
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
    active: p.boolean(), // Whether this is the currently active topic
  },
});
```

#### `TeachMission` — one per topic

```typescript
// db-schemas/TeachMission.ts
const TeachMissionSchema = defineEntity({
  name: 'TeachMission',
  properties: {
    id: p.integer().primary(),
    topic: () => p.oneToOne(TeachTopic, { owner: true }),
    why: p.text(), // 1-3 sentences: the concrete real-world goal
    successLooksLike: p.text(), // Bullet list of observable outcomes
    constraints: p.text(), // Time, budget, preferences
    outOfScope: p.text(), // Adjacent topics explicitly excluded
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});
```

#### `TeachGlossary` — one per topic (collection of terms)

```typescript
// db-schemas/TeachGlossary.ts
const TeachGlossarySchema = defineEntity({
  name: 'TeachGlossary',
  properties: {
    id: p.integer().primary(),
    topic: () => p.oneToOne(TeachTopic, { owner: true }),
    description: p.text(), // 1-2 sentence description of the topic this glossary covers
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});
```

#### `TeachGlossaryTerm` — individual terms within a glossary

```typescript
// db-schemas/TeachGlossaryTerm.ts
const TeachGlossaryTermSchema = defineEntity({
  name: 'TeachGlossaryTerm',
  properties: {
    id: p.integer().primary(),
    glossary: () => p.manyToOne(TeachGlossary),
    term: p.string(), // The canonical term
    definition: p.text(), // 1-2 sentence tight definition
    avoidList: p.text(), // JSON array of aliases to avoid
    groupHeading: p.string().nullable(), // Optional subheading group
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});
```

#### `TeachResource` — curated trusted sources

```typescript
// db-schemas/TeachResource.ts
const TeachResourceSchema = defineEntity({
  name: 'TeachResource',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    category: p.string(), // 'knowledge' | 'wisdom' | 'gap'
    title: p.string(), // e.g. "Book: The Science and Practice of Strength Training"
    url: p.string().nullable(),
    annotation: p.text(), // What it covers and when to reach for it
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});
```

#### `TeachLearningRecord` — ADR-like numbered records

```typescript
// db-schemas/TeachLearningRecord.ts
const TeachLearningRecordSchema = defineEntity({
  name: 'TeachLearningRecord',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    sequenceNumber: p.integer(), // 0001, 0002, etc. — auto-incremented per topic
    title: p.string(), // Short title of what was learned
    body: p.text(), // 1-3 sentences: what was learned and why it matters
    status: p.string(), // 'active' | 'superseded by LR-NNNN'
    evidence: p.text().nullable(), // How the user demonstrated understanding
    implications: p.text().nullable(), // What this unlocks or rules out
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});
```

#### `TeachLesson` — self-contained HTML lessons

```typescript
// db-schemas/TeachLesson.ts
const TeachLessonSchema = defineEntity({
  name: 'TeachLesson',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    sequenceNumber: p.integer(), // 0001, 0002, etc.
    title: p.string(), // Lesson title
    slug: p.string(), // dash-case slug for URLs
    htmlContent: p.text(), // Full HTML document
    primarySourceTitle: p.string().nullable(),
    primarySourceUrl: p.string().nullable(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});
```

#### `TeachReferenceDocument` — compressed reference materials

```typescript
// db-schemas/TeachReferenceDocument.ts
const TeachReferenceDocumentSchema = defineEntity({
  name: 'TeachReferenceDocument',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    title: p.string(),
    slug: p.string(),
    htmlContent: p.text(), // Full HTML document (beautiful, printable)
    category: p.string(), // 'cheat-sheet' | 'glossary' | 'algorithm' | 'syntax' | 'other'
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});
```

#### `TeachNote` — scratchpad for teacher preferences

```typescript
// db-schemas/TeachNote.ts
const TeachNoteSchema = defineEntity({
  name: 'TeachNote',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    content: p.text(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});
```

### REST API Design

Routes are registered on the `rest-serve` Express app. All routes are prefixed with `/api/teach/`.

| Method | Path                                           | Purpose                                      |
| ------ | ---------------------------------------------- | -------------------------------------------- |
| `GET`  | `/api/teach/topics`                            | List all topics (id, slug, name, active)     |
| `GET`  | `/api/teach/topics/:topicId/lessons/:lessonId` | Serve a lesson as full HTML page             |
| `GET`  | `/api/teach/topics/:topicId/reference/:refId`  | Serve a reference document as full HTML page |
| `GET`  | `/api/teach/topics/:topicId/glossary`          | Serve the glossary as an HTML page           |

Lessons and reference documents are served with `Content-Type: text/html; charset=utf-8` and `Cache-Control: no-store` (since they may be updated during a teaching session).

### Assistant Skill (via `skills` plugin)

A skill with id `teach` is registered at startup. Its `recallWhen` condition is:

> the user asks to learn something, be taught a topic, understand a concept, or requests a lesson on any subject

The skill content is a markdown document (`teach-skill.md`) containing the full teaching workflow instructions adapted from the original `SKILL.md`, but rewritten to reference the plugin's tools instead of filesystem files. The skill instructs the assistant to:

1. If no topic exists or the user hasn't specified one, use `teach.create_topic` to create one
2. If no mission exists, interview the user and use `teach.set_mission` to capture it
3. Use `teach.list_learning_records` to determine zone of proximal development
4. Use `teach.add_resource` to track trusted sources
5. Use `teach.create_lesson` to produce self-contained HTML lessons
6. Use `teach.add_glossary_term` when the user demonstrates understanding of a term
7. Use `teach.create_learning_record` when the user demonstrates genuine understanding, discloses prior knowledge, corrects a misconception, or the mission shifts
8. Use `teach.add_note` for scratchpad preferences
9. Use `teach.create_reference_document` for compressed reference materials

### Plugin Config Schema

```typescript
const TeachPluginConfigSchema = Type.Object({
  defaultTopicSlug: Type.Optional(
    Type.String({
      description:
        'The slug of the topic to treat as default when no topic is specified.',
    })
  ),
  lessonTemplateStyle: Type.Optional(
    Type.String({
      description:
        'CSS style preset for lesson HTML. Options: "tufte", "minimal", "dark".',
    })
  ),
  maxLearningRecordsPerTopic: Type.Optional(
    Type.Number({
      default: 1000,
      minimum: 1,
      description: 'Maximum number of learning records allowed per topic.',
    })
  ),
});
```

## New Package Dependencies

None. The plugin uses only existing project dependencies:

- `typebox` — tool parameter and config schemas (already in project)
- `@mikro-orm/sqlite` — entity definitions (already in project, used by `memory`)
- `express` — REST route registration (already in project, used by `rest-serve`)

## Project Structure

```
src/plugins/system/teach/
├── teach.ts                        # Plugin entry point
├── teach.test.ts                   # Tests (co-located)
├── teach-skill.md                  # Skill content registered with skills plugin
├── lesson-template.ts             # HTML generation for lessons
├── db-schemas/
│   ├── index.ts                    # Re-exports all entities
│   ├── TeachTopic.ts
│   ├── TeachMission.ts
│   ├── TeachGlossary.ts
│   ├── TeachGlossaryTerm.ts
│   ├── TeachResource.ts
│   ├── TeachLearningRecord.ts
│   ├── TeachLesson.ts
│   ├── TeachReferenceDocument.ts
│   └── TeachNote.ts
```

### Registration in `system-plugins.json`

Add to `src/plugins/system-plugins.json`:

```json
{
  "id": "teach",
  "name": "Teach",
  "category": "system",
  "required": false
}
```

## Implementation Steps

### Step 1: Create plugin directory and entity definitions

**Description:** Create the `src/plugins/system/teach/` directory structure and all 9 MikroORM entity definitions following the `defineEntity` pattern.

**Files to create:**

- `src/plugins/system/teach/db-schemas/TeachTopic.ts`
- `src/plugins/system/teach/db-schemas/TeachMission.ts`
- `src/plugins/system/teach/db-schemas/TeachGlossary.ts`
- `src/plugins/system/teach/db-schemas/TeachGlossaryTerm.ts`
- `src/plugins/system/teach/db-schemas/TeachResource.ts`
- `src/plugins/system/teach/db-schemas/TeachLearningRecord.ts`
- `src/plugins/system/teach/db-schemas/TeachLesson.ts`
- `src/plugins/system/teach/db-schemas/TeachReferenceDocument.ts`
- `src/plugins/system/teach/db-schemas/TeachNote.ts`
- `src/plugins/system/teach/db-schemas/index.ts`

**Dependencies:** None

**Complexity:** Medium (9 entities, but all follow the same well-established pattern)

### Step 2: Create the lesson HTML template module

**Description:** Build `lesson-template.ts` with a function `generateLessonHtml(options)` that produces a self-contained, Tufte-style HTML document. The template includes:

- Clean, readable typography (system font stack, generous line-height)
- Navigation breadcrumb: topic name → lesson title
- Primary source citation block
- "Ask a followup question" reminder footer
- Links to related lessons and reference documents (passed as options)
- Responsive layout suitable for both desktop and mobile

**Files to create:**

- `src/plugins/system/teach/lesson-template.ts`

**Dependencies:** None

**Complexity:** Medium (HTML/CSS design work, but self-contained)

### Step 3: Write the teach skill markdown document

**Description:** Create `teach-skill.md` — the markdown content registered as a recallable skill. This adapts the original `SKILL.md` teaching philosophy and workflow into instructions the assistant follows using the plugin's tools. Key adaptations:

- Replace "workspace directory" references with "the teach plugin's database"
- Replace file operations with tool calls (e.g., "read MISSION.md" → "use `teach.get_mission`")
- Preserve the philosophy sections: Fluency vs Storage Strength, Zone of Proximal Development, Knowledge/Skills/Wisdom triad
- Include the lesson design principles (beautiful, short, tied to mission, primary source citation, followup reminder)
- Include glossary and learning record rules

**Files to create:**

- `src/plugins/system/teach/teach-skill.md`

**Dependencies:** Step 1 (need to know final tool names)

**Complexity:** Medium (writing ~200 lines of well-structured markdown)

### Step 4: Register plugin in system-plugins.json

**Description:** Add the `teach` plugin entry to the built-in plugin registry.

**Files to modify:**

- `src/plugins/system-plugins.json` — add entry for `teach`

**Dependencies:** None

**Complexity:** Low

### Step 5: Implement the plugin entry point (`teach.ts`)

**Description:** The main plugin module. This is the largest step. It:

1. Declares `pluginMetadata` with `id: 'teach'`, dependencies on `memory`, `skills`, and `rest-serve`
2. Augments `PluginCapabilities` to offer a `teach` API (optional — other plugins might want to query teaching state)
3. Calls `plugin.config()` with the Typebox schema
4. Requests `memory` capabilities, registers all 9 entities via `registerDatabaseModels()`, and caches the ORM promise
5. Requests `skills` and registers the teach skill from `teach-skill.md`
6. Requests `rest-serve` and registers REST routes for serving lessons, reference docs, and the glossary
7. Registers all tools (see tool list below)
8. Registers lifecycle hooks with proper log prefixes

**Tools to register:**

| Tool Name                   | Purpose                                      | Parameters                                                                                                              |
| --------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `create_topic`              | Create a new teaching topic                  | `slug`, `name`                                                                                                          |
| `list_topics`               | List all topics                              | none                                                                                                                    |
| `set_active_topic`          | Set the active topic                         | `topicSlug`                                                                                                             |
| `get_mission`               | Get the mission for a topic                  | `topicSlug` (optional, defaults to active)                                                                              |
| `set_mission`               | Create or update the mission                 | `topicSlug`, `why`, `successLooksLike`, `constraints`, `outOfScope`                                                     |
| `add_glossary_term`         | Add or update a glossary term                | `topicSlug`, `term`, `definition`, `avoidList`, `groupHeading`                                                          |
| `list_glossary_terms`       | List all glossary terms for a topic          | `topicSlug`                                                                                                             |
| `remove_glossary_term`      | Remove a glossary term                       | `topicSlug`, `term`                                                                                                     |
| `add_resource`              | Add a curated resource                       | `topicSlug`, `category`, `title`, `url`, `annotation`                                                                   |
| `list_resources`            | List resources for a topic                   | `topicSlug`, `category` (optional filter)                                                                               |
| `remove_resource`           | Remove a resource                            | `topicSlug`, `resourceId`                                                                                               |
| `create_learning_record`    | Create a numbered learning record            | `topicSlug`, `title`, `body`, `evidence`, `implications`                                                                |
| `list_learning_records`     | List learning records for a topic            | `topicSlug`                                                                                                             |
| `get_learning_record`       | Get a specific learning record               | `topicSlug`, `sequenceNumber`                                                                                           |
| `supersede_learning_record` | Mark a record as superseded                  | `topicSlug`, `sequenceNumber`, `supersededByNumber`                                                                     |
| `create_lesson`             | Create a lesson (HTML generated server-side) | `topicSlug`, `title`, `bodyMarkdown`, `primarySourceTitle`, `primarySourceUrl`, `relatedLessonSlugs`, `relatedRefSlugs` |
| `list_lessons`              | List lessons for a topic                     | `topicSlug`                                                                                                             |
| `get_lesson_url`            | Get the REST URL to open a lesson            | `topicSlug`, `lessonSlug`                                                                                               |
| `create_reference_document` | Create a reference document                  | `topicSlug`, `title`, `slug`, `htmlContent`, `category`                                                                 |
| `list_reference_documents`  | List reference docs for a topic              | `topicSlug`                                                                                                             |
| `get_reference_url`         | Get the REST URL to open a reference doc     | `topicSlug`, `refSlug`                                                                                                  |
| `add_note`                  | Add or update a scratchpad note              | `topicSlug`, `content`                                                                                                  |
| `get_notes`                 | Get all notes for a topic                    | `topicSlug`                                                                                                             |
| `get_glossary_url`          | Get the REST URL to view the glossary        | `topicSlug`                                                                                                             |

**Files to create:**

- `src/plugins/system/teach/teach.ts`

**Files to modify:**

- None (new file)

**Dependencies:** Steps 1, 2, 3, 4

**Complexity:** High (~500-700 lines, 22 tools, REST routes, skill registration, entity registration)

### Step 6: Write tests

**Description:** Create `teach.test.ts` co-located with the plugin. Tests cover:

- **Unit tests:** Entity definitions are valid, lesson template produces valid HTML, tool parameter schemas validate correctly
- **Integration tests:** Mock `memory`, `skills`, and `rest-serve`; verify tools create/read/update/delete entities correctly; verify REST routes return correct content types and HTML; verify skill registration calls `skills.registerSkill` with correct content
- **Edge cases:** Creating a topic with a duplicate slug, superseding a non-existent learning record, adding a glossary term to a non-existent topic, serving a lesson that doesn't exist (404)

**Files to create:**

- `src/plugins/system/teach/teach.test.ts`

**Dependencies:** Step 5

**Complexity:** Medium

### Step 7: Integration verification

**Description:** Build the project, run the full test suite, and verify lint passes. Manually verify the plugin loads correctly by checking startup logs.

**Commands:**

```bash
npm run build
npm test
npm run lint
```

**Dependencies:** Steps 1-6

**Complexity:** Low

## File Changes Summary

| File                                                            | Action | Description                                |
| --------------------------------------------------------------- | ------ | ------------------------------------------ |
| `src/plugins/system/teach/db-schemas/TeachTopic.ts`             | Create | Topic container entity                     |
| `src/plugins/system/teach/db-schemas/TeachMission.ts`           | Create | Mission entity (1:1 with topic)            |
| `src/plugins/system/teach/db-schemas/TeachGlossary.ts`          | Create | Glossary container entity (1:1 with topic) |
| `src/plugins/system/teach/db-schemas/TeachGlossaryTerm.ts`      | Create | Individual glossary term entity            |
| `src/plugins/system/teach/db-schemas/TeachResource.ts`          | Create | Curated resource entity                    |
| `src/plugins/system/teach/db-schemas/TeachLearningRecord.ts`    | Create | Numbered learning record entity            |
| `src/plugins/system/teach/db-schemas/TeachLesson.ts`            | Create | HTML lesson entity                         |
| `src/plugins/system/teach/db-schemas/TeachReferenceDocument.ts` | Create | Reference document entity                  |
| `src/plugins/system/teach/db-schemas/TeachNote.ts`              | Create | Scratchpad note entity                     |
| `src/plugins/system/teach/db-schemas/index.ts`                  | Create | Barrel re-export                           |
| `src/plugins/system/teach/lesson-template.ts`                   | Create | HTML generation for lessons                |
| `src/plugins/system/teach/teach-skill.md`                       | Create | Skill content for `skills` plugin          |
| `src/plugins/system/teach/teach.ts`                             | Create | Plugin entry point (~500-700 lines)        |
| `src/plugins/system/teach/teach.test.ts`                        | Create | Unit and integration tests                 |
| `src/plugins/system-plugins.json`                               | Modify | Add `teach` entry                          |

## Testing Strategy

### Unit Tests

- **Entity validation:** Each entity schema compiles without error and has correct property types
- **Lesson template:** `generateLessonHtml()` produces valid HTML5 with correct structure (doctype, head, body, navigation, citation block, footer)
- **Tool parameter schemas:** Each Typebox schema validates correct input and rejects invalid input
- **Config schema:** Defaults are applied correctly, invalid config throws

### Integration Tests

- **CRUD operations for each entity type:** Create, read, update, delete through the tool execute functions
- **Topic isolation:** Operations on one topic do not affect another topic's data
- **Learning record numbering:** Sequence numbers auto-increment correctly per topic
- **REST routes:** `GET /api/teach/topics/:topicId/lessons/:lessonId` returns 200 with `text/html` for valid IDs, 404 for missing
- **Skill registration:** The `teach` skill is registered with `skills.registerSkill()` during plugin registration
- **Glossary term deduplication:** Adding a term that already exists updates it rather than creating a duplicate

### Manual Testing

1. Enable the plugin in `~/.alice-assistant/plugin-settings/enabled-plugins.json`
2. Start the assistant and verify the teach plugin loads without errors
3. Ask the assistant: "Teach me about TypeScript generics" — verify it creates a topic, interviews for mission, and begins producing lessons
4. Open a lesson URL in a browser and verify it renders as a clean, readable HTML page
5. Ask a followup question and verify the assistant references prior learning records

## Definition of Done

- [ ] All 9 entity definitions compile and follow the `defineEntity` + `setClass` pattern with `Teach`-prefixed table names
- [ ] `teach.ts` registers all entities with `memory`, registers the skill with `skills`, and registers REST routes with `rest-serve`
- [ ] All 22 tools are registered with Typebox parameter schemas and correct `availableFor` arrays
- [ ] REST routes serve lessons and reference documents as `text/html` with proper caching headers
- [ ] The teach skill markdown is complete and correctly adapts the original SKILL.md workflow
- [ ] Plugin config uses Typebox schema with sensible defaults
- [ ] Lifecycle hooks emit log messages with `[teach]` prefix before and after body
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (all existing tests + new teach tests)
- [ ] `npm run lint` passes
- [ ] Plugin entry exists in `system-plugins.json` with `required: false`
- [ ] Credit to mattpocock/skills is included in the plugin description and a comment at the top of `teach.ts`

## Risks & Mitigations

| Risk                                                                                  | Impact                                                                                     | Mitigation                                                                                                                                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML lesson content could be large (multi-KB), bloating the SQLite DB                 | Medium — SQLite handles text blobs fine, but very large lessons could slow queries         | Use `p.text()` (unlimited) for `htmlContent`; add a configurable `maxLessonSizeBytes` config option; the assistant is instructed to keep lessons short per the original philosophy |
| 22 tools is a large surface area — the assistant may struggle to choose the right one | Medium — tool descriptions must be clear and distinct                                      | Each tool has a focused, single-responsibility description; the teach skill provides workflow guidance on which tool to use when                                                   |
| Multiple concurrent topics could confuse the assistant about which topic is active    | Low — the `active` flag on `TeachTopic` and `set_active_topic` tool provide explicit state | Tools default to the active topic when `topicSlug` is omitted; the skill instructs the assistant to confirm the active topic at session start                                      |
| REST routes expose lesson content without authentication                              | Low — the REST server binds to localhost by default                                        | Document that lesson URLs are local-only; add a note in the plugin description                                                                                                     |
| The `skills` plugin may not be enabled (it's `required: false`)                       | Medium — teach depends on it                                                               | Declare `skills` as a dependency; the plugin engine will refuse to load teach if skills is disabled, with an actionable error message                                              |

## Timeline Estimate

- **Step 1 (Entities):** ~1 hour — 9 entities following a well-known pattern
- **Step 2 (Lesson template):** ~1.5 hours — HTML/CSS design and template function
- **Step 3 (Skill markdown):** ~1 hour — adapting the original SKILL.md
- **Step 4 (system-plugins.json):** ~5 minutes
- **Step 5 (teach.ts):** ~4 hours — the bulk of the work: 22 tools, REST routes, skill registration, entity registration, config, hooks
- **Step 6 (Tests):** ~2 hours — unit + integration tests
- **Step 7 (Integration verification):** ~30 minutes

**Total: ~10 hours** for a thorough, production-quality implementation.
