/**
 * @file tasks-types.ts
 *
 * Shared task type definitions for the tasks-broker plugin and its providers.
 *
 * These types define the contract between the tasks-broker (which owns the
 * LLM tools) and provider plugins (like google-tasks) that implement the
 * actual task operations.
 */

/** Standardized task item shape. */
export type TaskItem = {
  /** Unique task identifier (provider-specific). */
  id: string;
  /** Task title/summary. */
  title: string;
  /** Optional notes/details for the task. */
  notes?: string;
  /** Due date in ISO 8601 date format (YYYY-MM-DD). Tasks have dates, not datetimes. */
  due?: string;
  /** Task status: needsAction (incomplete) or completed. */
  status: 'needsAction' | 'completed';
  /** ISO 8601 datetime when the task was completed (only set when status is 'completed'). */
  completed?: string;
  /** ISO 8601 datetime when the task was last updated. */
  updated?: string;
  /** Parent task ID if this is a subtask. */
  parentTaskId?: string;
  /** Position string for ordering within the task list. */
  position?: string;
  /** Which provider owns this task. */
  providerId: string;
  /** Task list identifier (e.g. Google Tasks list ID). */
  taskListId: string;
};

/** Result shape for task operations. */
export type TaskActionResult = {
  provider: string;
  success: boolean;
  /** Human-readable result message. */
  message: string;
  taskId?: string;
};

/** Parameters for listing tasks. */
export type TaskGetParams = {
  /** Specific task list ID. Default: provider's default list. */
  taskListId?: string;
  /** Only return tasks with this status. Default: all tasks. */
  status?: 'needsAction' | 'completed';
  /** Only return tasks due on or before this date (ISO 8601 date). */
  dueMax?: string;
  /** Only return tasks due on or after this date (ISO 8601 date). */
  dueMin?: string;
  /** Maximum number of tasks to return. Default: 50. */
  maxResults?: number;
  /** If specified, only query this provider. Otherwise, query all providers. */
  provider?: string;
};

/** Parameters for creating a task. */
export type TaskCreateParams = {
  /** Task title (required). */
  title: string;
  /** Optional notes/details. */
  notes?: string;
  /** Due date in ISO 8601 date format (YYYY-MM-DD). */
  due?: string;
  /** Task list ID. Default: provider's default list. */
  taskListId?: string;
  /** Parent task ID for creating a subtask. */
  parentTaskId?: string;
  /** If specified, create on this provider. Otherwise, use the default provider. */
  provider?: string;
};

/** Parameters for updating a task. */
export type TaskUpdateParams = {
  /** ID of the task to update (required). */
  taskId: string;
  /** Task list ID containing the task. Default: provider's default list. */
  taskListId?: string;
  /** New title. */
  title?: string;
  /** New notes. */
  notes?: string;
  /** New due date (ISO 8601 date format). */
  due?: string;
  /** New status: 'needsAction' to un-complete, 'completed' to mark done. */
  status?: 'needsAction' | 'completed';
  /** If specified, update on this provider. Otherwise, try all providers. */
  provider?: string;
};

/** Parameters for deleting a task. */
export type TaskDeleteParams = {
  /** ID of the task to delete (required). */
  taskId: string;
  /** Task list ID containing the task. Default: provider's default list. */
  taskListId?: string;
  /** If specified, delete on this provider. Otherwise, try all providers. */
  provider?: string;
};

/**
 * The interface that task provider plugins implement.
 *
 * Each provider must provide all four methods. The broker dispatches
 * read operations (getTasks) to ALL providers in parallel, but
 * write operations (create, update, delete) to a specific provider.
 */
export type TaskProvider = {
  getTasks: (params: TaskGetParams) => Promise<TaskItem[]>;
  createTask: (params: TaskCreateParams) => Promise<TaskActionResult>;
  updateTask: (params: TaskUpdateParams) => Promise<TaskActionResult>;
  deleteTask: (params: TaskDeleteParams) => Promise<TaskActionResult>;
};
