---
name: database
description: Use when adding database entities or querying the memory plugin database. Trigger phrases: "new entity", "database", "MikroORM", "memory plugin", "registerEntities", "query memories", "persist data".
---

# Database Entities in Alice

The `memory` plugin owns all database access. Never create your own DB stack — depend on `memory` instead.

## Declaring an Entity

Define entities using MikroORM's `defineEntity()` and extend the generated class:

```typescript
import { defineEntity, p } from '@mikro-orm/sqlite';

const MyEntitySchema = defineEntity({
  name: 'MyEntity',
  properties: {
    id: p.integer().primary(),
    name: p.string(),
    createdAt: p.integer(), // Unix timestamp
  },
});

export class MyEntity extends MyEntitySchema.class {}
```

**Use `.class` and do not redeclare the fields.** The schema class provides the typed property accessors.

## Supported Property Types

| Builder                      | Type                        |
| ---------------------------- | --------------------------- |
| `p.integer()`                | Integer                     |
| `p.string()`                 | String                      |
| `p.number()`                 | Float                       |
| `p.boolean()`                | Boolean                     |
| `p.date()`                   | Date (stored as ISO string) |
| `p.json()`                   | JSON (stored as string)     |
| `p.manyToOne(Entity)`        | Foreign key                 |
| `p.oneToMany(Entity, field)` | Reverse side of relation    |
| `p.manyToMany(Entity)`       | Junction table              |

## Relations Example

```typescript
import { defineEntity, p } from '@mikro-orm/sqlite';

const MoodEntrySchema = defineEntity({
  name: 'MoodEntry',
  properties: {
    id: p.integer().primary(),
    score: p.integer(),
    note: p.string(),
    createdAt: p.integer(),
    memories: () => p.manyToMany(Memory),
  },
});

export class MoodEntry extends MoodEntrySchema.class {}
MoodEntrySchema.setClass(MoodEntry);
```

## Registering Entities with Memory

```typescript
const memory = plugin.request('memory');
if (!memory) {
  throw new Error('[my-plugin] memory plugin not available.');
}
memory.registerDatabaseModels([MyEntity]);
```

Register entities once during `registerPlugin`, before `onDatabaseReady` is called. The method name is `registerDatabaseModels`, not `registerEntities`.

## Accessing the ORM

Use `onDatabaseReady` to get the ORM after the database is initialized:

```typescript
memory.onDatabaseReady(async orm => {
  const em = orm.em.fork();
  const repo = em.getRepository(MyEntity);

  const entry = repo.create({ name: 'test', createdAt: Date.now() });
  await em.persistAndFlush(entry);

  const all = await repo.findAll();
  plugin.logger.info(`${all.length} entries found.`);
});
```

`onDatabaseReady` returns a promise that resolves with your callback's return value, so you can cache the ORM:

```typescript
const awaitForOrm = memory.onDatabaseReady(async orm => orm);
// later:
const orm = await awaitForOrm;
```

## Full Plugin Example

```typescript
import type { AlicePlugin } from '../../../lib/types/alice-plugin-interface.js';
import { defineEntity, p } from '@mikro-orm/sqlite';

const BookmarkSchema = defineEntity({
  name: 'Bookmark',
  properties: {
    id: p.integer().primary(),
    url: p.string(),
    label: p.string(),
    createdAt: p.integer(),
  },
});

export class Bookmark extends BookmarkSchema.class {}
BookmarkSchema.setClass(Bookmark);

export const bookmarkPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'bookmark',
    name: 'Bookmark',
    brandColor: '#4f46e5',
    description: 'Bookmark management.',
    version: '0.0.1',
    dependencies: [{ id: 'memory', version: 'LATEST' }],
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const memory = plugin.request('memory');

    if (!memory) {
      throw new Error('[bookmark] memory plugin not available.');
    }

    memory.registerDatabaseModels([Bookmark]);

    memory.onDatabaseReady(async orm => {
      const em = orm.em.fork();
      plugin.logger.info('Database ready.');

      const bookmark = em.getRepository(Bookmark).create({
        url: 'https://example.com',
        label: 'Example',
        createdAt: Date.now(),
      });
      await em.persistAndFlush(bookmark);
    });
  },
};
```

After adding entities, run `npm run build` and restart to apply migrations.
