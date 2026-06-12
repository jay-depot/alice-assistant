/**
 * @file tasks-broker.ts
 *
 * Tasks Broker plugin for A.L.I.C.E. Assistant.
 *
 * System broker that owns four LLM tools (list, create, update, delete)
 * and provides a provider registration API. Downstream provider plugins
 * (like google-tasks) register themselves with this broker to handle
 * task operations.
 *
 * Follows the calendar-broker pattern: dispatch read operations to all
 * providers in parallel, dispatch write operations (create, update, delete)
 * to a specific provider or the first registered provider.
 */

import Type, { Static } from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import type {
  TaskItem,
  TaskActionResult,
  TaskGetParams,
  TaskCreateParams,
  TaskUpdateParams,
  TaskDeleteParams,
  TaskProvider,
} from './tasks-types.js';

// ---------------------------------------------------------------------------
// Plugin config schema
// ---------------------------------------------------------------------------

const TasksBrokerPluginConfigSchema = Type.Object({
  /** Preferred task provider ID. If empty, the first registered provider is used. */
  defaultProvider: Type.Optional(
    Type.String({
      description:
        'The ID of the default task provider. If empty, the first registered provider is used.',
    })
  ),
  /** Default task list ID. Use "@default" for the provider's primary list. */
  defaultListId: Type.Optional(
    Type.String({
      description:
        'Default task list ID. Use "@default" for the primary task list. If empty, the provider default is used.',
      default: '@default',
    })
  ),
});

type TasksBrokerPluginConfig = Static<typeof TasksBrokerPluginConfigSchema>;

// ---------------------------------------------------------------------------
// LLM tool parameter schemas
// ---------------------------------------------------------------------------

const ListTasksToolParameters = Type.Object({
  status: Type.Optional(
    Type.String({
      description:
        'Filter by task status: "needsAction" for incomplete tasks, "completed" for completed tasks. Default: all tasks.',
    })
  ),
  dueMax: Type.Optional(
    Type.String({
      description:
        'Only return tasks due on or before this date (ISO 8601 date format, e.g. "2026-06-15").',
    })
  ),
  dueMin: Type.Optional(
    Type.String({
      description:
        'Only return tasks due on or after this date (ISO 8601 date format, e.g. "2026-06-01").',
    })
  ),
  maxResults: Type.Optional(
    Type.Number({
      description: 'Maximum number of tasks to return. Default: 50.',
      default: 50,
    })
  ),
});

type ListTasksToolParameters = Static<typeof ListTasksToolParameters>;

const CreateTaskToolParameters = Type.Object({
  title: Type.String({ description: 'Title/summary of the task.' }),
  notes: Type.Optional(
    Type.String({
      description: 'Optional notes or details for the task.',
    })
  ),
  due: Type.Optional(
    Type.String({
      description:
        'Due date in ISO 8601 date format (YYYY-MM-DD). Tasks have dates, not times.',
    })
  ),
});

type CreateTaskToolParameters = Static<typeof CreateTaskToolParameters>;

const UpdateTaskToolParameters = Type.Object({
  taskId: Type.String({ description: 'ID of the task to update.' }),
  title: Type.Optional(Type.String({ description: 'New title.' })),
  notes: Type.Optional(Type.String({ description: 'New notes.' })),
  due: Type.Optional(
    Type.String({
      description: 'New due date (ISO 8601 date format, YYYY-MM-DD).',
    })
  ),
  status: Type.Optional(
    Type.String({
      description:
        'New status: "needsAction" to mark incomplete, "completed" to mark done.',
    })
  ),
});

type UpdateTaskToolParameters = Static<typeof UpdateTaskToolParameters>;

const DeleteTaskToolParameters = Type.Object({
  taskId: Type.String({ description: 'ID of the task to delete.' }),
});

type DeleteTaskToolParameters = Static<typeof DeleteTaskToolParameters>;

// ---------------------------------------------------------------------------
// Plugin capabilities type augmentation
// ---------------------------------------------------------------------------

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'tasks-broker': {
      /** Register a task provider with the broker. */
      registerTaskProvider: (name: string, provider: TaskProvider) => void;

      /** Get tasks from all providers. Returns results keyed by provider name. */
      requestTasks: (
        params: TaskGetParams
      ) => Promise<Record<string, TaskItem[]>>;

      /** Create a task via a specific provider (or default/first provider). */
      requestTaskCreate: (
        params: TaskCreateParams
      ) => Promise<Record<string, TaskActionResult>>;

      /** Update a task. If provider is specified, use it; otherwise try all providers. */
      requestTaskUpdate: (
        params: TaskUpdateParams
      ) => Promise<Record<string, TaskActionResult>>;

      /** Delete a task. If provider is specified, use it; otherwise try all providers. */
      requestTaskDelete: (
        params: TaskDeleteParams
      ) => Promise<Record<string, TaskActionResult>>;
    };
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const tasksBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'tasks-broker',
    name: 'Tasks Broker Plugin',
    brandColor: '#5C9E3D',
    description:
      'Provides standardized task tools (tasks_broker.list, tasks_broker.create, ' +
      'tasks_broker.update, tasks_broker.delete) and a provider registration API for ' +
      'task plugins. Downstream provider plugins (like google-tasks) implement the ' +
      'actual task operations.',
    version: 'LATEST',
    dependencies: [],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    const config = await plugin.config<TasksBrokerPluginConfig>(
      TasksBrokerPluginConfigSchema,
      {}
    );

    // Provider registry: name → provider implementation
    const taskProviders: Record<string, TaskProvider> = {};

    // -------------------------------------------------------------------------
    // Dispatch functions
    // -------------------------------------------------------------------------

    /**
     * Get tasks from all registered providers in parallel.
     * Returns results keyed by provider name.
     */
    const requestTasks = async (
      params: TaskGetParams
    ): Promise<Record<string, TaskItem[]>> => {
      const providerNames = Object.keys(taskProviders);
      if (providerNames.length === 0) {
        return {};
      }

      const results: Record<string, TaskItem[]> = {};
      await Promise.all(
        providerNames.map(async name => {
          try {
            const providerResults = await taskProviders[name].getTasks(params);
            results[name] = providerResults;
          } catch (err) {
            plugin.logger.error(
              `requestTasks: Provider "${name}" failed: ${err instanceof Error ? err.message : String(err)}`
            );
            // Don't include failed providers — graceful degradation
          }
        })
      );
      return results;
    };

    /**
     * Create a task via a specific provider.
     * If params.provider is specified, use that provider.
     * Otherwise, use the configured default provider, or the first registered provider.
     */
    const requestTaskCreate = async (
      params: TaskCreateParams
    ): Promise<Record<string, TaskActionResult>> => {
      const providerNames = Object.keys(taskProviders);
      if (providerNames.length === 0) {
        return {};
      }

      // Determine which provider to use
      let targetProvider: string | undefined = params.provider;
      if (!targetProvider) {
        targetProvider =
          config.getPluginConfig().defaultProvider || providerNames[0];
      }

      if (!targetProvider || !taskProviders[targetProvider]) {
        const fallback = providerNames[0];
        plugin.logger.warn(
          `requestTaskCreate: Provider "${targetProvider}" not found, falling back to "${fallback}".`
        );
        targetProvider = fallback;
      }

      try {
        const result = await taskProviders[targetProvider].createTask(params);
        return { [targetProvider]: result };
      } catch (err) {
        return {
          [targetProvider]: {
            provider: targetProvider,
            success: false,
            message: `Failed to create task: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
      }
    };

    /**
     * Update a task.
     * If params.provider is specified, use that provider.
     * Otherwise, try each provider until one succeeds (since task IDs are provider-scoped,
     * only the owning provider will recognize the task).
     */
    const requestTaskUpdate = async (
      params: TaskUpdateParams
    ): Promise<Record<string, TaskActionResult>> => {
      const providerNames = Object.keys(taskProviders);
      if (providerNames.length === 0) {
        return {};
      }

      // If a specific provider is requested, use it
      if (params.provider && taskProviders[params.provider]) {
        try {
          const result =
            await taskProviders[params.provider].updateTask(params);
          return { [params.provider]: result };
        } catch (err) {
          return {
            [params.provider]: {
              provider: params.provider,
              success: false,
              message: `Failed to update task: ${err instanceof Error ? err.message : String(err)}`,
            },
          };
        }
      }

      // Otherwise, try each provider until one succeeds
      // (task IDs are provider-scoped, so only the owning provider will recognize the task)
      for (const name of providerNames) {
        try {
          const result = await taskProviders[name].updateTask(params);
          if (result.success) {
            return { [name]: result };
          }
        } catch {
          // This provider didn't recognize the task, try the next one
          continue;
        }
      }

      // No provider could update the task
      return {
        _none: {
          provider: '_none',
          success: false,
          message:
            'No task provider could update this task. The task ID may not exist in any connected task list.',
        },
      };
    };

    /**
     * Delete a task.
     * If params.provider is specified, use that provider.
     * Otherwise, try each provider until one succeeds.
     */
    const requestTaskDelete = async (
      params: TaskDeleteParams
    ): Promise<Record<string, TaskActionResult>> => {
      const providerNames = Object.keys(taskProviders);
      if (providerNames.length === 0) {
        return {};
      }

      // If a specific provider is requested, use it
      if (params.provider && taskProviders[params.provider]) {
        try {
          const result =
            await taskProviders[params.provider].deleteTask(params);
          return { [params.provider]: result };
        } catch (err) {
          return {
            [params.provider]: {
              provider: params.provider,
              success: false,
              message: `Failed to delete task: ${err instanceof Error ? err.message : String(err)}`,
            },
          };
        }
      }

      // Otherwise, try each provider until one succeeds
      for (const name of providerNames) {
        try {
          const result = await taskProviders[name].deleteTask(params);
          if (result.success) {
            return { [name]: result };
          }
        } catch {
          // This provider didn't recognize the task, try the next one
          continue;
        }
      }

      // No provider could delete the task
      return {
        _none: {
          provider: '_none',
          success: false,
          message:
            'No task provider could delete this task. The task ID may not exist in any connected task list.',
        },
      };
    };

    // -------------------------------------------------------------------------
    // Offer capabilities
    // -------------------------------------------------------------------------

    plugin.offer<'tasks-broker'>({
      registerTaskProvider: (name: string, provider: TaskProvider) => {
        taskProviders[name] = provider;
        plugin.logger.log(
          `registerTaskProvider: Registered task provider "${name}".`
        );
      },
      requestTasks,
      requestTaskCreate,
      requestTaskUpdate,
      requestTaskDelete,
    });

    // -------------------------------------------------------------------------
    // Register LLM tools
    // -------------------------------------------------------------------------

    plugin.registerTool({
      name: 'list',
      description:
        'List tasks from all connected task accounts. Returns tasks with title, status, due date, and notes.',
      availableFor: ['chat', 'voice'],
      systemPromptFragment:
        "You can check the user's task list using the tasks_broker.list tool. " +
        'Use it when the user asks about their tasks, to-do items, or what they need to do. ' +
        'Tasks are returned with title, status (needsAction/completed), due date, and notes. ' +
        'You can filter by status or due date range.',
      taintStatus: 'tainted',
      parameters: ListTasksToolParameters,
      execute: async (parameters: ListTasksToolParameters) => {
        const results = await requestTasks({
          status: parameters.status as 'needsAction' | 'completed' | undefined,
          dueMax: parameters.dueMax,
          dueMin: parameters.dueMin,
          maxResults: parameters.maxResults ?? 50,
        });

        const providerNames = Object.keys(results);
        if (providerNames.length === 0) {
          return 'No task providers are currently available. Please connect a task account (like Google Tasks) to use task features.';
        }

        const allResultsEmpty = providerNames.every(
          name => results[name].length === 0
        );
        if (allResultsEmpty) {
          const statusFilter = parameters.status
            ? ` with status "${parameters.status}"`
            : '';
          return `No tasks found${statusFilter}.`;
        }

        // Collect all tasks from all providers
        const allTasks: Array<{ provider: string; task: TaskItem }> = [];
        for (const [provider, tasks] of Object.entries(results)) {
          for (const task of tasks) {
            allTasks.push({ provider, task });
          }
        }

        // Sort: incomplete tasks first, then by due date (earliest first), then by title
        allTasks.sort((a, b) => {
          // Incomplete tasks first
          if (a.task.status !== b.task.status) {
            return a.task.status === 'needsAction' ? -1 : 1;
          }
          // Then by due date (earliest first, no due date last)
          if (a.task.due && b.task.due) {
            return a.task.due.localeCompare(b.task.due);
          }
          if (a.task.due) return -1;
          if (b.task.due) return 1;
          // Then by title
          return a.task.title.localeCompare(b.task.title);
        });

        const outputParts: string[] = [];
        for (const { provider, task } of allTasks) {
          const parts: string[] = [];
          const statusIcon = task.status === 'completed' ? '[✓]' : '[ ]';
          parts.push(`${statusIcon} ${task.title}`);
          if (task.notes) {
            parts.push(`  Notes: ${task.notes}`);
          }
          if (task.due) {
            parts.push(`  Due: ${task.due}`);
          }
          if (task.status === 'completed' && task.completed) {
            parts.push(`  Completed: ${task.completed}`);
          }
          parts.push(`  Provider: ${provider}`);
          parts.push(`  Task ID: ${task.id}`);
          outputParts.push(parts.join('\n'));
        }

        return outputParts.join('\n\n---\n\n');
      },
    });

    plugin.registerTool({
      name: 'create',
      description:
        'Create a new task. You MUST confirm the details with the user before creating any task.',
      availableFor: ['chat', 'voice'],
      systemPromptFragment:
        'You can create tasks using the tasks_broker.create tool. ' +
        'CRITICAL SAFETY RULES: ' +
        '1. ALWAYS confirm task details (title, due date, notes) with the user before creating. ' +
        '2. Only create tasks when the user explicitly asks you to. ' +
        '3. Due dates should be in YYYY-MM-DD format (tasks have dates, not times).',
      taintStatus: 'tainted',
      parameters: CreateTaskToolParameters,
      execute: async (parameters: CreateTaskToolParameters) => {
        const providerNames = Object.keys(taskProviders);
        if (providerNames.length === 0) {
          return 'No task providers are currently available. Please connect a task account (like Google Tasks) to use task features.';
        }

        const createParams: TaskCreateParams = {
          title: parameters.title,
          notes: parameters.notes,
          due: parameters.due,
        };

        const results = await requestTaskCreate(createParams);
        const resultProviderNames = Object.keys(results);
        if (resultProviderNames.length === 0) {
          return 'Failed to create task. No providers are available.';
        }

        const [providerName, result] = Object.entries(results)[0];

        if (result.success) {
          let confirmation = `Task created successfully via ${providerName}.\n`;
          confirmation += `Title: ${parameters.title}`;
          if (parameters.due) {
            confirmation += `\nDue: ${parameters.due}`;
          }
          if (parameters.notes) {
            confirmation += `\nNotes: ${parameters.notes}`;
          }
          if (result.taskId) {
            confirmation += `\nTask ID: ${result.taskId}`;
          }
          return confirmation;
        } else {
          return `Failed to create task via ${providerName}: ${result.message}`;
        }
      },
    });

    plugin.registerTool({
      name: 'update',
      description:
        'Update an existing task. You can change the title, notes, due date, or mark it as completed. You MUST confirm changes with the user before updating.',
      availableFor: ['chat', 'voice'],
      systemPromptFragment:
        'You can update tasks using the tasks_broker.update tool. ' +
        'CRITICAL SAFETY RULES: ' +
        '1. ALWAYS confirm the proposed changes with the user before updating a task. ' +
        '2. You need the task ID, which you can get from tasks_broker.list results. ' +
        '3. To mark a task as completed, set status to "completed". To un-complete, set status to "needsAction".',
      taintStatus: 'tainted',
      parameters: UpdateTaskToolParameters,
      execute: async (parameters: UpdateTaskToolParameters) => {
        const providerNames = Object.keys(taskProviders);
        if (providerNames.length === 0) {
          return 'No task providers are currently available. Please connect a task account (like Google Tasks) to use task features.';
        }

        const updateParams: TaskUpdateParams = {
          taskId: parameters.taskId,
          title: parameters.title,
          notes: parameters.notes,
          due: parameters.due,
          status: parameters.status as 'needsAction' | 'completed' | undefined,
        };

        const results = await requestTaskUpdate(updateParams);
        const resultProviderNames = Object.keys(results);
        if (resultProviderNames.length === 0) {
          return 'Failed to update task. No providers are available.';
        }

        const [providerName, result] = Object.entries(results)[0];

        if (result.success) {
          let confirmation = `Task updated successfully via ${providerName}.\n`;
          confirmation += `Task ID: ${parameters.taskId}`;
          const changes: string[] = [];
          if (parameters.title) changes.push(`title → "${parameters.title}"`);
          if (parameters.notes !== undefined) changes.push('notes updated');
          if (parameters.due) changes.push(`due → ${parameters.due}`);
          if (parameters.status)
            changes.push(`status → "${parameters.status}"`);
          if (changes.length > 0) {
            confirmation += `\nChanges: ${changes.join('; ')}`;
          }
          return confirmation;
        } else {
          return `Failed to update task via ${providerName}: ${result.message}`;
        }
      },
    });

    plugin.registerTool({
      name: 'delete',
      description:
        'Delete a task permanently. You MUST confirm with the user before deleting any task.',
      availableFor: ['chat', 'voice'],
      systemPromptFragment:
        'You can delete tasks using the tasks_broker.delete tool. ' +
        'CRITICAL SAFETY RULES: ' +
        '1. ALWAYS confirm with the user before deleting a task — this is permanent. ' +
        '2. You need the task ID, which you can get from tasks_broker.list results. ' +
        '3. If the user wants to mark a task as done instead of deleting, use tasks_broker.update with status "completed".',
      taintStatus: 'tainted',
      parameters: DeleteTaskToolParameters,
      execute: async (parameters: DeleteTaskToolParameters) => {
        const providerNames = Object.keys(taskProviders);
        if (providerNames.length === 0) {
          return 'No task providers are currently available. Please connect a task account (like Google Tasks) to use task features.';
        }

        const deleteParams: TaskDeleteParams = {
          taskId: parameters.taskId,
        };

        const results = await requestTaskDelete(deleteParams);
        const resultProviderNames = Object.keys(results);
        if (resultProviderNames.length === 0) {
          return 'Failed to delete task. No providers are available.';
        }

        const [providerName, result] = Object.entries(results)[0];

        if (result.success) {
          return `Task deleted successfully via ${providerName}.\nTask ID: ${parameters.taskId}`;
        } else {
          return `Failed to delete task via ${providerName}: ${result.message}`;
        }
      },
    });

    plugin.logger.log('registerPlugin: Tasks Broker plugin registered.');
  },
};

export default tasksBrokerPlugin;

// Re-export types for provider plugins to import
export type {
  TaskItem,
  TaskActionResult,
  TaskGetParams,
  TaskCreateParams,
  TaskUpdateParams,
  TaskDeleteParams,
  TaskProvider,
} from './tasks-types.js';
