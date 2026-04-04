import { Conversation, Message } from '../conversation.js';
import { DynamicPromptConversationType } from '../dynamic-prompt.js';

export type AlicePluginHooks = {
  /**
   * PENDING API SURFACE! NOT YET FULLY IMPLEMENTED.
   * 
   * Register a callback to be called when a "user conversation" is about to begin. 
   * Called before the conversation context is about to be sent to the LLM for the 
   * first time. This hook is NOT called for the initial "test" conversation at startup.
   *  
   * To ensure consistent behavior, this hook *should* only be registered during plugin 
   * registration, as a best practice, but late registration is allowed until the first 
   * time it is invoked. Practically, this means callbacks for this hook must be registered 
   * before or during `onAssistantWillAcceptRequests`.
   */
  onUserConversationWillBegin: (callback: (conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>) => void,
  
  /**
   * PENDING API SURFACE! NOT YET FULLY IMPLEMENTED.
   * 
   * Register a callback to be called when a "user conversation" is about to end.
   * Called under two conditions: 
   * 1. When the user clicks "end conversation" in the web UI
   * 2. When a voice conversation times out, and is about to be ended by the system.
   * 
   *  This hook is NOT called for the initial "test" conversation at startup.
   * 
   * To ensure consistent behavior, this hook *should* only be registered during plugin 
   * registration, as a best practice, but late registration is allowed until the first 
   * time it is invoked. Practically, this means callbacks for this hook must be registered 
   * before or during `onAssistantWillAcceptRequests`.
   */
  onUserConversationWillEnd: (callback: (conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>) => void,

  /**
   * Registers a callback to be called when a conversation's context has grown too long, 
   * even after compaction, and the oldest compaction summaries are about to be discarded.
   * 
   * To ensure consistent behavior, this hook *should* only be registered during plugin 
   * registration, as a best practice, but late registration is allowed until the first 
   * time it is invoked. Practically, this means callbacks for this hook must be registered 
   * before or during `onAssistantWillAcceptRequests`.
   * 
   * System Plugin timings:
   *  - memory stores the summaries that are about to be lost in the database when this 
   *    hook is invoked.
   */
  onContextCompactionSummariesWillBeDeleted: (callback: (summaries: Message[]) => Promise<void>) => void,

  /**
   * Registers a callback to be called when all plugins have been loaded.
   * 
   * This is the the earliest lifecycle event a plugin may register for. Callbacks 
   * may be registered for this hook until it has been invoked by the system. Practically, 
   * this means this hook may only be registered during plugin registration.
   * 
   * System Plugin timings:
   *  - memory initializes the database when this hook is invoked.
   */
  onAllPluginsLoaded: (callback: () => Promise<void>) => void,

  /**
   * Registers a callback to be called when the assistant is about to start accepting requests.
   * This happens immediately after all plugins that have registered for the onAllPluginsLoaded 
   * hook have finished their callbacks.
   * 
   * Callbacks may be registered for this hook until it has been invoked by the system. Practically, 
   * this means this hook may only be registered during plugin registration or an onAllPluginsLoaded 
   * callback.
   */
  onAssistantWillAcceptRequests: (callback: () => Promise<void>) => void,

  /**
   * Registers a callback to be called when the assistant has started accepting requests. 
   * This happens immediately after the onAssistantWillAcceptRequests hook is invoked and all 
   * its callbacks have finished.
   * 
   * Callbacks may be registered for this hook until it has been invoked by the system. Practically, 
   * this means this hook may only be registered during plugin registration, an onAllPluginsLoaded 
   * callback, or an onAssistantWillAcceptRequests callback.
   * 
   * System Plugin timings:
   * - web-ui becomes available when this hook is invoked.
   */
  onAssistantAcceptsRequests: (callback: () => Promise<void>) => void,

  /**
   * Registers a callback to be called when the assistant is about to stop accepting 
   * requests. Currently, this only happens when the the process receives a shutdown signal.
   * 
   * Callbacks may be registered for this hook until it has been invoked by the system. 
   * Practically, this means this hook may be registered during: plugin registration, an 
   * onAllPluginsLoaded callback, an onAssistantWillAcceptRequests callback, or an 
   * onAssistantAcceptsRequests callback.
   *  
   * System Plugin timings::
   *  - web-ui is not longer available when this hook is invoked.
   *  - memory closes the database connection when this hook is invoked.
   */
  onAssistantWillStopAcceptingRequests: (callback: () => Promise<void>) => void,

  /**
   * Registers a callback to be called when the assistant has stopped accepting requests. 
   * This happens immediately after the onAssistantWillStopAcceptingRequests hook is invoked 
   * and all its callbacks have finished.
   * 
   * Callbacks may be registered for this hook until it has been invoked by the system. Practically, 
   * this means this hook may be registered during: plugin registration, an onAllPluginsLoaded 
   * callback, an onAssistantWillAcceptRequests callback, an onAssistantAcceptsRequests callback, 
   * or an onAssistantWillStopAcceptingRequests callback.
   */
  onAssistantStoppedAcceptingRequests: (callback: () => Promise<void>) => void,

  /**
   * Registers a callback to be called when the system is about to unload all plugins, which 
   * happens right before shutdown. This is the last lifecycle event for which plugins can 
   * register callbacks.
   * 
   * Callbacks may be registered for this hook until it has been invoked by the system. Practically, 
   * this means this hook may be registered at almost any time, as long as it is before or 
   * during `onAssistantStoppedAcceptingRequests`.
   */
  onPluginsWillUnload: (callback: () => Promise<void>) => void,
};
