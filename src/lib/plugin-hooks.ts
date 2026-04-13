import {
  AlicePluginHooks,
  Conversation,
  DynamicPromptConversationType,
  Message,
  TaskAssistantEvents,
} from '../lib.js';
import type {
  ActiveTaskAssistantInstance,
  TaskAssistantResult,
} from '../lib.js';
import { systemLogger } from './system-logger.js';

const registeredHooks: {
  onUserConversationWillBegin: Array<
    (
      conversation: Conversation,
      type: DynamicPromptConversationType
    ) => Promise<void>
  >;
  onUserConversationWillEnd: Array<
    (
      conversation: Conversation,
      type: DynamicPromptConversationType
    ) => Promise<void>
  >;
  onContextCompactionSummariesWillBeDeleted: Array<
    (summaries: Message[]) => Promise<void>
  >;
  onAllPluginsLoaded: Array<() => Promise<void>>;
  onAssistantWillAcceptRequests: Array<() => Promise<void>>;
  onAssistantAcceptsRequests: Array<() => Promise<void>>;
  onAssistantWillStopAcceptingRequests: Array<() => Promise<void>>;
  onAssistantStoppedAcceptingRequests: Array<() => Promise<void>>;
  onPluginsWillUnload: Array<() => Promise<void>>;
  onUserPluginsUnloaded: Array<() => Promise<void>>;
  onSystemPluginsWillUnload: Array<() => Promise<void>>;
  onTaskAssistantWillBegin: Array<
    (instance: ActiveTaskAssistantInstance) => Promise<void>
  >;
  onTaskAssistantWillEnd: Array<
    (
      instance: ActiveTaskAssistantInstance,
      result: TaskAssistantResult
    ) => Promise<void>
  >;
} = {
  onUserConversationWillBegin: [],
  onUserConversationWillEnd: [],
  onContextCompactionSummariesWillBeDeleted: [],
  onAllPluginsLoaded: [],
  onAssistantWillAcceptRequests: [],
  onAssistantAcceptsRequests: [],
  onAssistantWillStopAcceptingRequests: [],
  onAssistantStoppedAcceptingRequests: [],
  onPluginsWillUnload: [],
  onUserPluginsUnloaded: [],
  onSystemPluginsWillUnload: [],
  onTaskAssistantWillBegin: [],
  onTaskAssistantWillEnd: [],
};

const isRegistrationOpenForHook = {
  onUserConversationWillBegin: true,
  onUserConversationWillEnd: true,
  onContextCompactionSummariesWillBeDeleted: true,
  onSystemPluginsLoaded: true,
  onUserPluginsWillLoad: true,
  onAllPluginsLoaded: true,
  onAssistantWillAcceptRequests: true,
  onAssistantAcceptsRequests: true,
  onAssistantWillStopAcceptingRequests: true,
  onAssistantStoppedAcceptingRequests: true,
  onPluginsWillUnload: true,
  onUserPluginsUnloaded: true,
  onSystemPluginsWillUnload: true,
};

export const PluginHooks: (
  pluginId: string
) => AlicePluginHooks = pluginId => ({
  onUserConversationWillBegin: (
    callback: (
      conversation: Conversation,
      type: DynamicPromptConversationType
    ) => Promise<void>
  ) => {
    if (!isRegistrationOpenForHook.onUserConversationWillBegin) {
      throw new Error(
        `${pluginId} tried to register onUserConversationWillBegin too late.The onUserConversationWillBegin hook can only be registered before the first conversation begins. Please disable ${pluginId} to fix your assistant. If you are developing this plugin, check your hook timings.`
      );
    }
    registeredHooks.onUserConversationWillBegin.push(callback);
  },
  onUserConversationWillEnd: (
    callback: (
      conversation: Conversation,
      type: DynamicPromptConversationType
    ) => Promise<void>
  ) => {
    if (!isRegistrationOpenForHook.onUserConversationWillEnd) {
      throw new Error(
        `${pluginId} tried to register onUserConversationWillEnd too late. The onUserConversationWillEnd hook can only be registered before the first conversation ends. Please disable ${pluginId} to fix your assistant. If you are developing this plugin, check your hook timings.`
      );
    }
    registeredHooks.onUserConversationWillEnd.push(callback);
  },
  onContextCompactionSummariesWillBeDeleted: (
    callback: (summaries: Message[]) => Promise<void>
  ) => {
    if (!isRegistrationOpenForHook.onContextCompactionSummariesWillBeDeleted) {
      throw new Error(
        `${pluginId} tried to register onContextCompactionSummariesWillBeDeleted too late. The onContextCompactionSummariesWillBeDeleted hook can only be registered before the first context compaction purge occurs. Please disable ${pluginId} to fix your assistant. If you are developing this plugin, check your hook timings.`
      );
    }
    registeredHooks.onContextCompactionSummariesWillBeDeleted.push(callback);
  },
  onAllPluginsLoaded: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onAllPluginsLoaded) {
      throw new Error(
        `${pluginId} tried to register onAllPluginsLoaded too late. The onAllPluginsLoaded hook can only be registered during plugin registration. Please disable ${pluginId} to fix your assistant. If you are developing this plugin, check your hook timings.`
      );
    }
    registeredHooks.onAllPluginsLoaded.push(callback);
  },
  onAssistantWillAcceptRequests: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onAssistantWillAcceptRequests) {
      throw new Error(
        `${pluginId} tried to register onAssistantWillAcceptRequests too late. The onAssistantWillAcceptRequests hook can only be registered during plugin registration or an onAllPluginsLoaded callback. Please disable ${pluginId} to fix your assistant. If you are developing this plugin, check your hook timings.`
      );
    }
    registeredHooks.onAssistantWillAcceptRequests.push(callback);
  },
  onAssistantAcceptsRequests: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onAssistantAcceptsRequests) {
      throw new Error(
        `${pluginId} tried to register onAssistantAcceptsRequests too late. The onAssistantAcceptsRequests hook can only be registered during plugin registration, an onAllPluginsLoaded callback, or an onAssistantWillAcceptRequests callback. Please disable ${pluginId} to fix your assistant. If you are developing this plugin, check your hook timings.`
      );
    }
    registeredHooks.onAssistantAcceptsRequests.push(callback);
  },
  onAssistantWillStopAcceptingRequests: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onAssistantWillStopAcceptingRequests) {
      throw new Error(
        `${pluginId} tried to register onAssistantWillStopAcceptingRequests too late. The onAssistantWillStopAcceptingRequests hook can only be registered during plugin registration, an onAllPluginsLoaded callback, an onAssistantWillAcceptRequests callback, or an onAssistantAcceptsRequests callback. Please disable ${pluginId} to fix your assistant. If you are developing this plugin, check your hook timings.`
      );
    }
    registeredHooks.onAssistantWillStopAcceptingRequests.push(callback);
  },
  onAssistantStoppedAcceptingRequests: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onAssistantStoppedAcceptingRequests) {
      throw new Error(
        `${pluginId} tried to register onAssistantStoppedAcceptingRequests too late. The onAssistantStoppedAcceptingRequests hook can only be registered during plugin registration, an onAllPluginsLoaded callback, an onAssistantWillAcceptRequests callback, an onAssistantAcceptsRequests callback, or an onAssistantWillStopAcceptingRequests callback. Please disable ${pluginId} to fix your assistant. If you are developing this plugin, check your hook timings.`
      );
    }
    registeredHooks.onAssistantStoppedAcceptingRequests.push(callback);
  },
  onPluginsWillUnload: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onPluginsWillUnload) {
      throw new Error(
        `${pluginId} tried to register onPluginsWillUnload too late. The onPluginsWillUnload hook can only be registered before or during onAssistantStoppedAcceptingRequests. Please disable ${pluginId} to fix your assistant. If you are developing this plugin, check your hook timings.`
      );
    }
    registeredHooks.onPluginsWillUnload.push(callback);
  },
  onTaskAssistantWillBegin: (
    callback: (instance: ActiveTaskAssistantInstance) => Promise<void>
  ) => {
    registeredHooks.onTaskAssistantWillBegin.push(callback);
  },
  onTaskAssistantWillEnd: (
    callback: (
      instance: ActiveTaskAssistantInstance,
      result: TaskAssistantResult
    ) => Promise<void>
  ) => {
    registeredHooks.onTaskAssistantWillEnd.push(callback);
  },
});

export const PluginHookInvocations = {
  invokeOnUserConversationWillBegin: async (
    conversation: Conversation,
    type: DynamicPromptConversationType
  ) => {
    for (const callback of registeredHooks.onUserConversationWillBegin) {
      await callback(conversation, type);
    }
  },
  invokeOnUserConversationWillEnd: async (
    conversation: Conversation,
    type: DynamicPromptConversationType
  ) => {
    for (const callback of registeredHooks.onUserConversationWillEnd) {
      await callback(conversation, type);
    }
  },
  invokeOnContextCompactionSummariesWillBeDeleted: async (
    summaries: Message[]
  ) => {
    for (const callback of registeredHooks.onContextCompactionSummariesWillBeDeleted) {
      await callback(summaries);
    }
  },
  invokeOnAllPluginsLoaded: async () => {
    isRegistrationOpenForHook.onAllPluginsLoaded = false;
    systemLogger.log(
      `[plugin-hooks] invokeOnAllPluginsLoaded: Starting callback dispatch (${registeredHooks.onAllPluginsLoaded.length} callback(s)).`
    );
    for (const callback of registeredHooks.onAllPluginsLoaded) {
      await callback();
    }
    systemLogger.log(
      '[plugin-hooks] invokeOnAllPluginsLoaded: Completed callback dispatch.'
    );
  },
  invokeOnAssistantWillAcceptRequests: async () => {
    isRegistrationOpenForHook.onAssistantWillAcceptRequests = false;
    systemLogger.log(
      `[plugin-hooks] invokeOnAssistantWillAcceptRequests: Starting callback dispatch (${registeredHooks.onAssistantWillAcceptRequests.length} callback(s)).`
    );
    for (const callback of registeredHooks.onAssistantWillAcceptRequests) {
      await callback();
    }
    systemLogger.log(
      '[plugin-hooks] invokeOnAssistantWillAcceptRequests: Completed callback dispatch.'
    );
  },
  invokeOnAssistantAcceptsRequests: async () => {
    isRegistrationOpenForHook.onAssistantAcceptsRequests = false;
    systemLogger.log(
      `[plugin-hooks] invokeOnAssistantAcceptsRequests: Starting callback dispatch (${registeredHooks.onAssistantAcceptsRequests.length} callback(s)).`
    );
    for (const callback of registeredHooks.onAssistantAcceptsRequests) {
      await callback();
    }
    systemLogger.log(
      '[plugin-hooks] invokeOnAssistantAcceptsRequests: Completed callback dispatch.'
    );
  },
  invokeOnAssistantWillStopAcceptingRequests: async () => {
    isRegistrationOpenForHook.onAssistantWillStopAcceptingRequests = false;
    systemLogger.log(
      `[plugin-hooks] invokeOnAssistantWillStopAcceptingRequests: Starting callback dispatch (${registeredHooks.onAssistantWillStopAcceptingRequests.length} callback(s)).`
    );
    for (const callback of registeredHooks.onAssistantWillStopAcceptingRequests) {
      await callback();
    }
    systemLogger.log(
      '[plugin-hooks] invokeOnAssistantWillStopAcceptingRequests: Completed callback dispatch.'
    );
  },
  invokeOnAssistantStoppedAcceptingRequests: async () => {
    isRegistrationOpenForHook.onAssistantStoppedAcceptingRequests = false;
    systemLogger.log(
      `[plugin-hooks] invokeOnAssistantStoppedAcceptingRequests: Starting callback dispatch (${registeredHooks.onAssistantStoppedAcceptingRequests.length} callback(s)).`
    );
    for (const callback of registeredHooks.onAssistantStoppedAcceptingRequests) {
      await callback();
    }
    systemLogger.log(
      '[plugin-hooks] invokeOnAssistantStoppedAcceptingRequests: Completed callback dispatch.'
    );
  },
  invokeOnPluginsWillUnload: async () => {
    isRegistrationOpenForHook.onPluginsWillUnload = false;
    systemLogger.log(
      `[plugin-hooks] invokeOnPluginsWillUnload: Starting callback dispatch (${registeredHooks.onPluginsWillUnload.length} callback(s)).`
    );
    for (const callback of registeredHooks.onPluginsWillUnload) {
      await callback();
    }
    systemLogger.log(
      '[plugin-hooks] invokeOnPluginsWillUnload: Completed callback dispatch.'
    );
  },
};

// Wire TaskAssistantEvents so that task assistant lifecycle events fan out to registered plugin hooks.
TaskAssistantEvents.onBegin(async (instance: ActiveTaskAssistantInstance) => {
  systemLogger.log(
    `[plugin-hooks] onTaskAssistantWillBegin: Starting callback dispatch (${registeredHooks.onTaskAssistantWillBegin.length} callback(s)) for session ${instance.parentSessionId}.`
  );
  for (const callback of registeredHooks.onTaskAssistantWillBegin) {
    await callback(instance);
  }
  systemLogger.log(
    `[plugin-hooks] onTaskAssistantWillBegin: Completed callback dispatch for session ${instance.parentSessionId}.`
  );
});

TaskAssistantEvents.onEnd(
  async (
    instance: ActiveTaskAssistantInstance,
    result: TaskAssistantResult
  ) => {
    systemLogger.log(
      `[plugin-hooks] onTaskAssistantWillEnd: Starting callback dispatch (${registeredHooks.onTaskAssistantWillEnd.length} callback(s)) for session ${instance.parentSessionId} with status ${result.status}.`
    );
    for (const callback of registeredHooks.onTaskAssistantWillEnd) {
      await callback(instance, result);
    }
    systemLogger.log(
      `[plugin-hooks] onTaskAssistantWillEnd: Completed callback dispatch for session ${instance.parentSessionId} with status ${result.status}.`
    );
  }
);
