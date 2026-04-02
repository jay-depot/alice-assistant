import { AlicePluginHooks, Conversation, DynamicPromptConversationType, Message, Tool } from '../lib.js';

const registeredHooks: {
  onUserConversationWillBegin: Array<(conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>>;
  onUserConversationWillEnd: Array<(conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>>;
  onToolWillBeCalled: Array<(tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>) => Promise<void>>;
  onToolWasCalled: Array<(tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>, result: string) => Promise<void>>;
  onContextCompactionSummariesWillBeDeleted: Array<(summaries: Message[]) => Promise<void>>;
  onAllPluginsLoaded: Array<() => Promise<void>>;
  onAssistantWillAcceptRequests: Array<() => Promise<void>>;
  onAssistantAcceptsRequests: Array<() => Promise<void>>;
  onAssistantWillStopAcceptingRequests: Array<() => Promise<void>>;
  onAssistantStoppedAcceptingRequests: Array<() => Promise<void>>;
  onPluginsWillUnload: Array<() => Promise<void>>;
  onUserPluginsUnloaded: Array<() => Promise<void>>;
  onSystemPluginsWillUnload: Array<() => Promise<void>>;
} = {
  onUserConversationWillBegin: [],
  onUserConversationWillEnd: [],
  onToolWillBeCalled: [],
  onToolWasCalled: [],
  onContextCompactionSummariesWillBeDeleted: [],
  onAllPluginsLoaded: [],
  onAssistantWillAcceptRequests: [],
  onAssistantAcceptsRequests: [],
  onAssistantWillStopAcceptingRequests: [],
  onAssistantStoppedAcceptingRequests: [],
  onPluginsWillUnload: [],
  onUserPluginsUnloaded: [],
  onSystemPluginsWillUnload: [],
};

const isRegistrationOpenForHook = {
  onUserConversationWillBegin: true,
  onUserConversationWillEnd: true,
  onToolWillBeCalled: true,
  onToolWasCalled: true,
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
}

export const PluginHooks:AlicePluginHooks = {
  onUserConversationWillBegin: (callback: (conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>) => {
    if (!isRegistrationOpenForHook.onUserConversationWillBegin) {
      throw new Error('The onUserConversationWillBegin hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onUserConversationWillBegin.push(callback);
  },
  onUserConversationWillEnd: (callback: (conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>) => {
    if (!isRegistrationOpenForHook.onUserConversationWillEnd) {
      throw new Error('The onUserConversationWillEnd hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onUserConversationWillEnd.push(callback);
  },
  onToolWillBeCalled: (callback: (tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>) => Promise<void>) => {
    if (!isRegistrationOpenForHook.onToolWillBeCalled) {
      throw new Error('The onToolWillBeCalled hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onToolWillBeCalled.push(callback);
  },
  onToolWasCalled: (callback: (tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>, result: string) => Promise<void>) => {
    if (!isRegistrationOpenForHook.onToolWasCalled) {
      throw new Error('The onToolWasCalled hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onToolWasCalled.push(callback);
  },
  onContextCompactionSummariesWillBeDeleted: (callback: (summaries: Message[]) => Promise<void>) => {
    if (!isRegistrationOpenForHook.onContextCompactionSummariesWillBeDeleted) {
      throw new Error('The onContextCompactionSummariesWillBeDeleted hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onContextCompactionSummariesWillBeDeleted.push(callback);
  },
  onAllPluginsLoaded: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onAllPluginsLoaded) {
      throw new Error('The onAllPluginsLoaded hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onAllPluginsLoaded.push(callback);
  },
  onAssistantWillAcceptRequests: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onAssistantWillAcceptRequests) {
      throw new Error('The onAssistantWillAcceptRequests hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onAssistantWillAcceptRequests.push(callback);
  },
  onAssistantAcceptsRequests: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onAssistantAcceptsRequests) {
      throw new Error('The onAssistantAcceptsRequests hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onAssistantAcceptsRequests.push(callback);
  },
  onAssistantWillStopAcceptingRequests: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onAssistantWillStopAcceptingRequests) {
      throw new Error('The onAssistantWillStopAcceptingRequests hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onAssistantWillStopAcceptingRequests.push(callback);
  },
  onAssistantStoppedAcceptingRequests: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onAssistantStoppedAcceptingRequests) {
      throw new Error('The onAssistantStoppedAcceptingRequests hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onAssistantStoppedAcceptingRequests.push(callback);
  },
  onPluginsWillUnload: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onPluginsWillUnload) {
      throw new Error('The onPluginsWillUnload hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onPluginsWillUnload.push(callback);
  },
  onUserPluginsUnloaded: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onUserPluginsUnloaded) {
      throw new Error('The onUserPluginsUnloaded hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onUserPluginsUnloaded.push(callback);
  },
  onSystemPluginsWillUnload: (callback: () => Promise<void>) => {
    if (!isRegistrationOpenForHook.onSystemPluginsWillUnload) {
      throw new Error('The onSystemPluginsWillUnload hook can only be registered during plugin registration. Please disable any plugins that are trying to register this hook to fix your assistant.');
    }
    registeredHooks.onSystemPluginsWillUnload.push(callback);
  },
};

export const PluginHookInvocations = {
  invokeOnUserConversationWillBegin: async (conversation: Conversation, type: DynamicPromptConversationType) => {
    for (const callback of registeredHooks.onUserConversationWillBegin) {
      await callback(conversation, type);
    }
  },
  invokeOnUserConversationWillEnd: async (conversation: Conversation, type: DynamicPromptConversationType) => {
    for (const callback of registeredHooks.onUserConversationWillEnd) {
      await callback(conversation, type);
    }
  },
  invokeOnToolWillBeCalled: async (tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>) => {
    for (const callback of registeredHooks.onToolWillBeCalled) {
      await callback(tool, args);
    }
  },
  invokeOnToolWasCalled: async (tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>, result: string) => {
    for (const callback of registeredHooks.onToolWasCalled) {
      await callback(tool, args, result);
    }
  },
  invokeOnContextCompactionSummariesWillBeDeleted: async (summaries: Message[]) => {
    for (const callback of registeredHooks.onContextCompactionSummariesWillBeDeleted) {
      await callback(summaries);
    }
  },
  invokeOnAllPluginsLoaded: async () => {
    isRegistrationOpenForHook.onAllPluginsLoaded = false;
    for (const callback of registeredHooks.onAllPluginsLoaded) {
      await callback();
    }
  },
  invokeOnAssistantWillAcceptRequests: async () => {
    isRegistrationOpenForHook.onAssistantWillAcceptRequests = false;
    for (const callback of registeredHooks.onAssistantWillAcceptRequests) {
      await callback();
    }
  },
  invokeOnAssistantAcceptsRequests: async () => {
    isRegistrationOpenForHook.onAssistantAcceptsRequests = false;
    for (const callback of registeredHooks.onAssistantAcceptsRequests) {
      await callback();
    }
  },
  invokeOnAssistantWillStopAcceptingRequests: async () => {
    isRegistrationOpenForHook.onAssistantWillStopAcceptingRequests = false;
    for (const callback of registeredHooks.onAssistantWillStopAcceptingRequests) {
      await callback();
    }
  },
  invokeOnAssistantStoppedAcceptingRequests: async () => {
    isRegistrationOpenForHook.onAssistantStoppedAcceptingRequests = false;
    for (const callback of registeredHooks.onAssistantStoppedAcceptingRequests) {
      await callback();
    }
  },
  invokeOnPluginsWillUnload: async () => {
    isRegistrationOpenForHook.onPluginsWillUnload = false;
    for (const callback of registeredHooks.onPluginsWillUnload) {
      await callback();
    }
  },
  invokeOnUserPluginsUnloaded: async () => {
    isRegistrationOpenForHook.onUserPluginsUnloaded = false;
    for (const callback of registeredHooks.onUserPluginsUnloaded) {
      await callback();
    }
  },
  invokeOnSystemPluginsWillUnload: async () => {
    isRegistrationOpenForHook.onSystemPluginsWillUnload = false;
    for (const callback of registeredHooks.onSystemPluginsWillUnload) {
      await callback();
    }
  },
}
