import { Conversation } from '../conversation.js';
import { DynamicPromptConversationType } from '../dynamic-prompt.js';
import { Tool } from '../tool-system.js';

export type AlicePluginHooks = {
  onUserConversationWillBegin: (callback: (conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>) => void,
  onUserConversationWillEnd: (callback: (conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>) => void,
  onToolWillBeCalled: (callback: (tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>) => Promise<void>) => void,
  onToolWasCalled: (callback: (tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>, result: string) => Promise<void>) => void,
  onAllPluginsLoaded: (callback: () => Promise<void>) => void,
  onAssistantWillAcceptRequests: (callback: () => Promise<void>) => void,
  onAssistantAcceptsRequests: (callback: () => Promise<void>) => void,
  onAssistantWillStopAcceptingRequests: (callback: () => Promise<void>) => void,
  onAssistantStoppedAcceptingRequests: (callback: () => Promise<void>) => void,
  onPluginsWillUnload: (callback: () => Promise<void>) => void,
  onUserPluginsUnloaded: (callback: () => Promise<void>) => void,
  onSystemPluginsWillUnload: (callback: () => Promise<void>) => void,
};
