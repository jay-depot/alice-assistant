# Implementation Plan: Google Tasks Integration

## Overview

Add Google Tasks API integration to A.L.I.C.E. Assistant, following the established `calendar-broker`/`google-calendar` pattern. This includes extending the `google-apis` plugin to support the Tasks API OAuth scope and creating a `tasks-broker` system plugin with a `google-tasks` community provider plugin.

## Requirements Summary

| Requirement           | Detail                                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| Read/Write Operations | List, Create, Update (including complete), Delete tasks                  |
| Completed Tasks       | Remain in list (no archival)                                             |
| Multi-Account         | Supported via google-apis plugin's existing multi-account infrastructure |
| Tool Availability     | Chat and Voice only (not autonomy)                                       |
| Data Persistence      | Ephemeral - only what's in Google, no local sync                         |
| UI                    | LLM tools only, no web UI components                                     |

## Architecture & Design

```
┌─────────────────────────────────────────────────────────────────┐
│                        LLM / Assistant                          │
│                    (calendar_broker.* tools)                    │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │    tasks-broker       │
                    │   (system plugin)     │
                    │                       │
                    │  - Owns tool registry │
                    │  - Provider dispatch  │
                    │  - Type definitions   │
                    └───────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
   ┌──────────▼──────────┐      │      ┌──────────▼──────────┐
   │   google-tasks      │      │      │   (future: another  │
   │  (community plugin) │      │      │    tasks provider)  │
   │                     │      │      └──────────────────────┘
   │  - OAuth via        │      │
   │    google-apis      │      │
   │  - Registers as     │      │
   │    provider         │      │
   └──────────┬──────────┘      │
              │                 │
┌─────────────▼─────────────────▼─────────────────────────────────┐
│                      google-apis                                │
│                   (community plugin)                            │
│                                                                  │
│  - OAuth flow + token management                                │
│  - Offers: getTasksClient(), listAccounts(), etc.               │
│  - Add: 'https://www.googleapis.com/auth/tasks' scope           │
│  - Add: getTasksClient() capability                             │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Google Tasks API     │
                    │   (https://tasks.googleapis.com)  │
                    └───────────────────────┘
```

### Component Breakdown

| Component      | Type             | Responsibility                                                             |
| -------------- | ---------------- | -------------------------------------------------------------------------- |
| `tasks-broker` | System plugin    | Owns tools (`list`, `create`, `update`, `delete`), dispatches to providers |
| `google-tasks` | Community plugin | Implements `TaskProvider`, registers via `google-apis` OAuth               |
| `google-apis`  | Community plugin | OAuth infrastructure, add Tasks scope + `getTasksClient()`                 |

### Data Models

**TaskItem** (returned from Google, normalized):

```typescript
export type TaskItem = {
  id: string;
  title: string;
  notes?: string;
  due?: string; // ISO 8601 date (not datetime)
  status: 'needsAction' | 'completed';
  completed?: string; // ISO 8601 datetime when completed
  updated?: string; // ISO 8601 datetime
  parentTaskId?: string; // For subtasks
  position?: string; // Ordering within list
  providerId: string;
  taskListId: string;
};

export type TaskActionResult = {
  provider: string;
  success: boolean;
  message: string;
  taskId?: string;
};
```

## New Package Dependencies

| Package             | Version  | Reason                                   |
| ------------------- | -------- | ---------------------------------------- |
| `@googleapis/tasks` | `^1.0.0` | Official Google Tasks API client library |

## Project Structure

```
src/plugins/
├── system/
│   └── tasks-broker/
│       ├── tasks-broker.ts          # Main plugin, tools, dispatch
│       └── tasks-types.ts           # TaskProvider interface, types
├── community/
│   └── google-tasks/
│       ├── google-tasks.ts          # Provider implementation
│       └── package.json             # If external deps needed
```

## Implementation Steps

### Step 1: Extend google-apis with Tasks scope and client

**File:** `src/plugins/community/google-apis/oauth-manager.ts`

- Add `'https://www.googleapis.com/auth/tasks'` to `GOOGLE_SCOPES` array
- Add `getTasksClient()` method to `OAuthManager` class
- Returns a `tasks_v2.Tasks` client authenticated for the account

**File:** `src/plugins/community/google-apis/google-apis.ts`

- Extend `GoogleApisCapability` interface with `getTasksClient()`
- Update `offer()` to include `getTasksClient`

**Complexity:** Low

---

### Step 2: Create tasks-broker types

**File:** `src/plugins/system/tasks-broker/tasks-types.ts`

Define:

- `TaskItem`, `TaskActionResult`
- `TaskGetParams`, `TaskCreateParams`, `TaskUpdateParams`, `TaskDeleteParams`
- `TaskProvider` interface (must implement: `getTasks`, `createTask`, `updateTask`, `deleteTask`)

**Complexity:** Low

---

### Step 3: Create tasks-broker plugin

**File:** `src/plugins/system/tasks-broker/tasks-broker.ts`

**3.1 Plugin metadata:**

```typescript
const tasksBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'tasks-broker',
    name: 'Tasks Broker',
    brandColor: '#5C9E3D', // Google Tasks green
    description:
      'Provides unified access to task providers (Google Tasks, etc.)',
    version: 'LATEST',
    dependencies: [], // No required dependencies
    required: false,
  },
  // ...
};
```

**3.2 Config schema:**

```typescript
const TasksBrokerPluginConfigSchema = Type.Object({
  defaultProvider: Type.Optional(
    Type.String({
      description: 'The ID of the default task provider.',
    })
  ),
  defaultListId: Type.Optional(
    Type.String({
      description: 'Default task list ID or "@default" for primary list.',
      default: '@default',
    })
  ),
});
```

**3.3 PluginCapabilities type augmentation:**

```typescript
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'tasks-broker': {
      registerTaskProvider: (name: string, provider: TaskProvider) => void;
      requestTasks: (
        params: TaskGetParams
      ) => Promise<Record<string, TaskItem[]>>;
      requestTaskCreate: (
        params: TaskCreateParams
      ) => Promise<Record<string, TaskActionResult>>;
      requestTaskUpdate: (
        params: TaskUpdateParams
      ) => Promise<Record<string, TaskActionResult>>;
      requestTaskDelete: (
        params: TaskDeleteParams
      ) => Promise<Record<string, TaskActionResult>>;
    };
  }
}
```

**3.4 Tools to register:**
| Tool Name | Description | Available For |
|-----------|-------------|---------------|
| `list` | List tasks from all providers | `['chat', 'voice']` |
| `create` | Create a new task | `['chat', 'voice']` |
| `update` | Update an existing task (including mark complete) | `['chat', 'voice']` |
| `delete` | Delete a task | `['chat', 'voice']` |

**3.5 Dispatch logic:**

- `requestTasks` - parallel fan-out to all providers (read)
- `requestTaskCreate/Update/Delete` - dispatch to default provider or specified provider (write)

**Complexity:** Medium

---

### Step 4: Create google-tasks provider plugin

**File:** `src/plugins/community/google-tasks/google-tasks.ts`

**4.1 Plugin metadata:**

```typescript
const googleTasksPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'google-tasks',
    name: 'Google Tasks',
    brandColor: '#4285f4',
    description: 'Google Tasks provider for tasks-broker',
    version: 'LATEST',
    dependencies: [
      { id: 'google-apis', version: 'LATEST' },
      { id: 'tasks-broker', version: 'LATED' },
    ],
    required: false,
  },
  // ...
};
```

**4.2 TaskProvider implementation:**

- `getTasks`: Call `tasks.tasks.list()` with optional `taskList` filter, map response to `TaskItem[]`
- `createTask`: Call `tasks.tasks.insert()`, map response
- `updateTask`: Call `tasks.tasks.patch()`, map response
- `deleteTask`: Call `tasks.tasks.delete()`, return result

**4.3 Provider registration:**

- In `onAssistantAcceptsRequests` hook
- For each authenticated Google account, register provider as `google-tasks:{accountId}`

**4.4 Helper functions for Google Tasks API ↔ `TaskItem` mapping:**

```typescript
function mapGoogleTaskToTaskItem(
  task: GoogleTasksTask,
  providerId: string,
  taskListId: string
): TaskItem {
  return {
    id: task.id!,
    title: task.title!,
    notes: task.notes,
    due: task.due, // Already ISO 8601 date string
    status: task.status as 'needsAction' | 'completed',
    completed: task.completed, // ISO 8601 datetime
    updated: task.updated,
    parentTaskId: task.parent,
    position: task.position,
    providerId,
    taskListId,
  };
}
```

**Complexity:** Medium

---

### Step 5: Update system-plugins.json

**File:** `src/plugins/system-plugins.json`

Add entry for `tasks-broker`:

```json
{
  "id": "tasks-broker",
  "name": "Tasks Broker",
  "version": "LATEST",
  "enabled": true,
  "required": false
}
```

Note: `google-tasks` remains in community plugins (not in system-plugins.json) since it's optional.

---

### Step 6: Verify build and tests

**6.1 Run build:**

```bash
npm run build
```

**6.2 Run tests:**

```bash
npm test
```

**6.3 Manual verification:**

- Connect a Google account via the web UI (google-apis)
- Verify tasks-broker tools appear in the system prompt
- Test listing, creating, updating, and deleting tasks via chat

**Complexity:** Low

---

## File Changes Summary

| File                                                 | Action | Description                                              |
| ---------------------------------------------------- | ------ | -------------------------------------------------------- |
| `src/plugins/community/google-apis/oauth-manager.ts` | Modify | Add Tasks scope, `getTasksClient()` method               |
| `src/plugins/community/google-apis/google-apis.ts`   | Modify | Add `getTasksClient` to `GoogleApisCapability` interface |
| `src/plugins/system/tasks-broker/tasks-types.ts`     | Create | Type definitions and `TaskProvider` interface            |
| `src/plugins/system/tasks-broker/tasks-broker.ts`    | Create | Main plugin with tools and dispatch                      |
| `src/plugins/community/google-tasks/google-tasks.ts` | Create | Google Tasks provider implementation                     |
| `src/plugins/system-plugins.json`                    | Modify | Add `tasks-broker` entry                                 |

## Testing Strategy

### Unit Tests

| File                   | What to Test                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `tasks-broker.test.ts` | Dispatch logic (fan-out for reads, single provider for writes), default provider fallback |
| `google-tasks.test.ts` | Google API → `TaskItem` mapping, error handling                                           |

### Integration Tests

| File                               | What to Test                                                           |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `tasks-broker.integration.test.ts` | Full flow: google-tasks registers → tasks-broker receives → tools work |

### Manual Testing Checklist

- [ ] `calendar_broker.list` returns task items (no events mixed in)
- [ ] `calendar_broker.create` creates a task in Google
- [ ] `calendar_broker.update` can mark a task as completed
- [ ] `calendar_broker.delete` removes a task from Google
- [ ] Multi-account: tasks from multiple Google accounts appear in list
- [ ] OAuth flow works for Google Tasks scope

## Definition of Done

- [ ] `npm run build` completes without errors
- [ ] `npm test` passes
- [ ] Tasks scope (`https://www.googleapis.com/auth/tasks`) added to google-apis OAuth
- [ ] `tasks-broker` system plugin registered in `system-plugins.json`
- [ ] `tasks-broker` exposes 4 tools: `list`, `create`, `update`, `delete`
- [ ] `google-tasks` community plugin implements `TaskProvider` interface
- [ ] `google-tasks` registers providers for each authenticated Google account
- [ ] Tools work via chat interface (LLM can list/create/update/delete tasks)
- [ ] Completed tasks remain in the list (no archival behavior)
- [ ] Multi-account Google support works

## Risks & Mitigations

| Risk                                                    | Impact | Mitigation                                                                                                   |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| Google Tasks API has different data model than Calendar | Medium | Tasks don't have time-of-day, only date. Must handle `TaskItems.list` returning items without `start`/`end`. |
| OAuth scope addition requires re-auth                   | Medium | Existing users will be prompted for new scope on next OAuth flow; no data migration needed                   |
| Tasks and Calendar broker confusion                     | Low    | Clear naming in system prompts: "tasks" vs "calendar" are distinct                                           |
| @googleapis/tasks package version changes               | Low    | Pin to `^1.0.0` and verify API compatibility before upgrading                                                |

## Timeline Estimate

**Assumptions:**

- OAuth flow in google-apis works correctly
- `@googleapis/tasks` package API matches expectations
- Existing calendar-broker pattern is stable

**Estimate:** 4-6 hours for implementation, 1-2 hours for testing.

## Reference: Google Tasks API Basics

**API Endpoint:** `tasks.tasks` (from `@googleapis/tasks`)

**Key operations:**

```typescript
// List tasks
tasks.tasks.list({ tasklist: taskListId });

// Create task
tasks.tasks.insert({
  tasklist: taskListId,
  requestBody: { title: '...', notes: '...' },
});

// Update task (including complete)
tasks.tasks.patch({
  tasklist: taskListId,
  task: taskId,
  requestBody: { status: 'completed' },
});

// Delete task
tasks.tasks.delete({ tasklist: taskListId, task: taskId });
```

**Task list ID:**

- Use `@default` for the user's default task list
- Or get list via `tasks.tasklists.list()`
