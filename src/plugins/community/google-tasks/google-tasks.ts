/**
 * @file google-tasks.ts
 *
 * Google Tasks provider plugin for A.L.I.C.E. Assistant.
 *
 * Community plugin that bridges the Google Tasks API v1 into the
 * tasks-broker. For each authenticated Google account, it registers
 * a separate task provider named `google-tasks:{accountId}`.
 *
 * Dependencies: google-apis (for OAuth clients), tasks-broker (for provider registration).
 */

import Type, { Static } from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import type { GoogleApisCapability } from '../google-apis/google-apis.js';
import type {
  TaskItem,
  TaskActionResult,
  TaskGetParams,
  TaskCreateParams,
  TaskUpdateParams,
  TaskDeleteParams,
  TaskProvider,
} from '../../system/tasks-broker/tasks-types.js';

// ---------------------------------------------------------------------------
// Plugin config schema
// ---------------------------------------------------------------------------

const GoogleTasksPluginConfigSchema = Type.Object({
  /** Preferred Google account ID to use. If empty, uses the first available account. */
  preferredAccount: Type.Optional(
    Type.String({
      description:
        'The Google account ID to prefer for task operations. If empty, the first available account is used.',
    })
  ),
  /** Default task list ID. "@default" uses the user's default task list. */
  defaultTaskList: Type.Optional(
    Type.String({
      description:
        'The default task list ID to use. "@default" uses the user\'s default task list.',
      default: '@default',
    })
  ),
  /** Maximum number of results per query. Default: 50 */
  maxResultsPerQuery: Type.Optional(
    Type.Number({
      description: 'Maximum number of tasks to return per query. Default: 50.',
      default: 50,
    })
  ),
});

type GoogleTasksPluginConfig = Static<typeof GoogleTasksPluginConfigSchema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TasksClient = any; // tasks_v1.Tasks from @googleapis/tasks

// ---------------------------------------------------------------------------
// Google Tasks → TaskItem mapping
// ---------------------------------------------------------------------------

/**
 * Convert a Google Tasks API task resource to our TaskItem format.
 */
function googleTaskToTaskItem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gTask: any,
  providerId: string,
  taskListId: string
): TaskItem {
  return {
    id: gTask.id ?? '',
    title: gTask.title ?? '(No title)',
    notes: gTask.notes ?? undefined,
    due: gTask.due ?? undefined,
    status: gTask.status ?? 'needsAction',
    completed: gTask.completed ?? undefined,
    updated: gTask.updated ?? undefined,
    parentTaskId: gTask.parent ?? undefined,
    position: gTask.position ?? undefined,
    providerId,
    taskListId,
  };
}

/**
 * Convert TaskCreateParams to a Google Tasks task resource.
 */
function createParamsToGoogleTask(
  params: TaskCreateParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const task: any = {
    title: params.title,
  };

  if (params.notes) {
    task.notes = params.notes;
  }

  if (params.due) {
    // Google Tasks API expects RFC 3339 date format (YYYY-MM-DD)
    task.due = params.due;
  }

  return task;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const googleTasksPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'google-tasks',
    name: 'Google Tasks Plugin',
    brandColor: '#4285F4', // Google Blue
    description:
      'Provides Google Tasks functionality through the tasks-broker plugin. ' +
      'Requires the google-apis plugin with an authenticated Google account.',
    version: 'LATEST',
    dependencies: [
      { id: 'google-apis', version: 'LATEST' },
      { id: 'tasks-broker', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config<GoogleTasksPluginConfig>(
      GoogleTasksPluginConfigSchema,
      { defaultTaskList: '@default', maxResultsPerQuery: 50 }
    );

    // Request capabilities from dependencies
    const googleApis = plugin.request('google-apis') as
      | GoogleApisCapability
      | undefined;
    const tasksBroker = plugin.request('tasks-broker');

    if (!googleApis) {
      plugin.logger.error(
        'registerPlugin: google-apis capability not available. ' +
          'Ensure the google-apis plugin is enabled and loaded before google-tasks.'
      );
      return;
    }

    if (!tasksBroker) {
      plugin.logger.error(
        'registerPlugin: tasks-broker capability not available. ' +
          'Ensure the tasks-broker plugin is enabled and loaded before google-tasks.'
      );
      return;
    }

    // Register providers after google-apis has restored accounts from the vault.
    // onAssistantAcceptsRequests fires after ALL onAssistantWillAcceptRequests
    // hooks have completed, so the account store will definitely be populated
    // by the time we call listAccounts().
    plugin.hooks.onAssistantAcceptsRequests(async () => {
      plugin.logger.log(
        'onAssistantAcceptsRequests: Registering Google Tasks providers.'
      );

      const accountIds = googleApis.listAccounts();

      if (accountIds.length === 0) {
        plugin.logger.warn(
          'onAssistantAcceptsRequests: No Google accounts are connected. ' +
            'The google-tasks plugin requires at least one authenticated Google account. ' +
            'Please connect a Google account via the google-apis web UI.'
        );
        return;
      }

      for (const accountId of accountIds) {
        const accountInfo = googleApis.getAccountInfo(accountId);

        if (!accountInfo?.isAuthenticated) {
          plugin.logger.warn(
            `onAssistantAcceptsRequests: Google account "${accountId}" is not authenticated. Skipping.`
          );
          continue;
        }

        const providerName = `google-tasks:${accountId}`;

        const provider: TaskProvider = {
          getTasks: (params: TaskGetParams) =>
            getTasks(
              googleApis,
              accountId,
              params,
              config.getPluginConfig(),
              plugin.logger
            ),

          createTask: (params: TaskCreateParams) =>
            createTask(
              googleApis,
              accountId,
              params,
              config.getPluginConfig(),
              plugin.logger
            ),

          updateTask: (params: TaskUpdateParams) =>
            updateTask(
              googleApis,
              accountId,
              params,
              config.getPluginConfig(),
              plugin.logger
            ),

          deleteTask: (params: TaskDeleteParams) =>
            deleteTask(
              googleApis,
              accountId,
              params,
              config.getPluginConfig(),
              plugin.logger
            ),
        };

        tasksBroker.registerTaskProvider(providerName, provider);

        plugin.logger.log(
          `onAssistantAcceptsRequests: Registered task provider "${providerName}".`
        );
      }
    });
  },
};

// ---------------------------------------------------------------------------
// Google Tasks API operations
// ---------------------------------------------------------------------------

/**
 * Resolve the task list ID from params, config, or default.
 * "@default" maps to the user's default task list.
 */
function resolveTaskListId(
  paramsTaskListId: string | undefined,
  config: GoogleTasksPluginConfig
): string {
  if (paramsTaskListId && paramsTaskListId !== '@default') {
    return paramsTaskListId;
  }
  if (config.defaultTaskList && config.defaultTaskList !== '@default') {
    return config.defaultTaskList;
  }
  return '@default';
}

async function getTasks(
  googleApis: GoogleApisCapability,
  accountId: string,
  params: TaskGetParams,
  pluginConfig: GoogleTasksPluginConfig,
  logger: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  }
): Promise<TaskItem[]> {
  try {
    const tasksClient = (await googleApis.getTasksClient(
      accountId
    )) as TasksClient | null;

    if (!tasksClient) {
      logger.error(
        `getTasks: Could not get Tasks client for account "${accountId}".`
      );
      return [];
    }

    const taskListId = resolveTaskListId(params.taskListId, pluginConfig);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listParams: any = {
      tasklist: taskListId,
      maxResults: params.maxResults ?? pluginConfig.maxResultsPerQuery ?? 50,
    };

    if (params.dueMin) {
      listParams.dueMin = params.dueMin;
    }

    if (params.dueMax) {
      listParams.dueMax = params.dueMax;
    }

    if (params.status === 'completed') {
      listParams.showCompleted = true;
      listParams.showHidden = true;
    } else if (params.status === 'needsAction') {
      listParams.showCompleted = false;
      listParams.showHidden = false;
    }
    // If no status filter, show all (completed + active)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await tasksClient.tasks.list(listParams);

    const tasks = response.data?.items ?? [];

    return tasks.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (t: any) =>
        googleTaskToTaskItem(t, `google-tasks:${accountId}`, taskListId)
    );
  } catch (err) {
    logger.error(
      `getTasks: Google Tasks tasks.list failed for account "${accountId}": ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

async function createTask(
  googleApis: GoogleApisCapability,
  accountId: string,
  params: TaskCreateParams,
  pluginConfig: GoogleTasksPluginConfig,
  logger: { error: (...args: unknown[]) => void }
): Promise<TaskActionResult> {
  try {
    const tasksClient = (await googleApis.getTasksClient(
      accountId
    )) as TasksClient | null;
    if (!tasksClient) {
      return {
        provider: `google-tasks:${accountId}`,
        success: false,
        message: `Could not get Tasks client for account "${accountId}".`,
      };
    }

    const taskResource = createParamsToGoogleTask(params);
    const taskListId = resolveTaskListId(params.taskListId, pluginConfig);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertParams: any = {
      tasklist: taskListId,
      requestBody: taskResource,
    };

    if (params.parentTaskId) {
      insertParams.parent = params.parentTaskId;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await tasksClient.tasks.insert(insertParams);

    return {
      provider: `google-tasks:${accountId}`,
      success: true,
      message: 'Task created successfully.',
      taskId: response.data?.id ?? undefined,
    };
  } catch (err) {
    logger.error(
      `createTask: Failed for account "${accountId}": ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      provider: `google-tasks:${accountId}`,
      success: false,
      message: `Failed to create task: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function updateTask(
  googleApis: GoogleApisCapability,
  accountId: string,
  params: TaskUpdateParams,
  pluginConfig: GoogleTasksPluginConfig,
  logger: { error: (...args: unknown[]) => void }
): Promise<TaskActionResult> {
  try {
    const tasksClient = (await googleApis.getTasksClient(
      accountId
    )) as TasksClient | null;
    if (!tasksClient) {
      return {
        provider: `google-tasks:${accountId}`,
        success: false,
        message: `Could not get Tasks client for account "${accountId}".`,
      };
    }

    const taskListId = resolveTaskListId(params.taskListId, pluginConfig);

    // Build a partial update object — only include fields that are defined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateBody: any = {};

    if (params.title !== undefined) {
      updateBody.title = params.title;
    }
    if (params.notes !== undefined) {
      updateBody.notes = params.notes;
    }
    if (params.due !== undefined) {
      updateBody.due = params.due;
    }
    if (params.status !== undefined) {
      updateBody.status = params.status;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await tasksClient.tasks.patch({
      tasklist: taskListId,
      task: params.taskId,
      requestBody: updateBody,
    });

    return {
      provider: `google-tasks:${accountId}`,
      success: true,
      message: 'Task updated successfully.',
      taskId: response.data?.id ?? params.taskId,
    };
  } catch (err) {
    // If the task doesn't exist on this provider, return failure
    // so the broker can try other providers
    const error: Error | null = err instanceof Error ? err : null;
    const is404 =
      error?.message?.includes('404') || String(err).includes('not found');
    if (is404) {
      return {
        provider: `google-tasks:${accountId}`,
        success: false,
        message: 'Task not found on this provider.',
      };
    }

    logger.error(
      `updateTask: Failed for account "${accountId}": ${error?.message ?? String(err)}`
    );
    return {
      provider: `google-tasks:${accountId}`,
      success: false,
      message: `Failed to update task: ${error?.message ?? String(err)}`,
    };
  }
}

async function deleteTask(
  googleApis: GoogleApisCapability,
  accountId: string,
  params: TaskDeleteParams,
  pluginConfig: GoogleTasksPluginConfig,
  logger: { error: (...args: unknown[]) => void }
): Promise<TaskActionResult> {
  try {
    const tasksClient = (await googleApis.getTasksClient(
      accountId
    )) as TasksClient | null;
    if (!tasksClient) {
      return {
        provider: `google-tasks:${accountId}`,
        success: false,
        message: `Could not get Tasks client for account "${accountId}".`,
      };
    }

    const taskListId = resolveTaskListId(params.taskListId, pluginConfig);

    await tasksClient.tasks.delete({
      tasklist: taskListId,
      task: params.taskId,
    });

    return {
      provider: `google-tasks:${accountId}`,
      success: true,
      message: 'Task deleted successfully.',
      taskId: params.taskId,
    };
  } catch (err) {
    const error: Error | null = err instanceof Error ? err : null;
    const is404 =
      error?.message?.includes('404') || String(err).includes('not found');
    if (is404) {
      return {
        provider: `google-tasks:${accountId}`,
        success: false,
        message: 'Task not found on this provider.',
      };
    }

    logger.error(
      `deleteTask: Failed for account "${accountId}": ${error?.message ?? String(err)}`
    );
    return {
      provider: `google-tasks:${accountId}`,
      success: false,
      message: `Failed to delete task: ${error?.message ?? String(err)}`,
    };
  }
}

export default googleTasksPlugin;
