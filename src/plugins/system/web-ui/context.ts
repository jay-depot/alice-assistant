// context.ts — Shared state for all server-side web-ui modules.
// Modules that are extracted from web-ui.ts receive a WebUiContext instead of
// capturing the closure's local variables directly.

import type { PluginLogger } from '../../../lib/plugin-logger.js';
import type { AliceUiScriptRegistration } from '../../../lib/types/alice-plugin-interface.js';
import type { Conversation } from '../../../lib/conversation.js';
import type { MikroORM } from '@mikro-orm/sqlite';
import type { Express } from 'express';
import type { WsServerMessage } from './ws-types.js';

// ── Reusable types that were previously inline in web-ui.ts ──────────────

export interface RegisteredUiExtension extends AliceUiScriptRegistration {
  groupKey: string;
}

export interface PendingToolCallRound {
  role: 'assistant';
  messageKind: 'tool_call';
  content: string;
  timestamp: Date;
  senderName: null;
  toolCallData: {
    callBatchId: string;
    toolName: string;
    status: 'completed' | 'error';
    resultSummary?: string;
    error?: string;
    requiresApproval?: boolean;
    taskAssistantId?: string;
    agentName?: string;
  };
}

// ── Shared context type ──────────────────────────────────────────────────
// Passed to every extracted module so they can access the shared mutable
// state that was previously in registerPlugin's closure.

export interface WebUiContext {
  /** Plugin logger with the web-ui prefix and brand colour. */
  logger: PluginLogger;

  /**
   * Resolves with the MikroORM instance once the database is ready.
   * Signature matches the memory plugin's `onDatabaseReady` callback.
   */
  onDatabaseReady: <T>(cb: (orm: MikroORM) => Promise<T>) => Promise<T>;

  /** Express app from the rest-serve plugin. Routes are mounted on this. */
  app: Express;

  /** Conversation objects cached by session id for reuse across turns. */
  cachedChatConversations: Map<number, Conversation>;

  /** Serialised operation queues, one per session id. Prevents concurrent
   *  mutations of the same ChatSession. */
  sessionOperationQueues: Map<number, Promise<void>>;

  /** Buffered tool call rounds waiting to be flushed into the DB at the
   *  correct interleaving position. */
  pendingToolCallRounds: Map<number, PendingToolCallRound[]>;

  /** Broadcasts a WsServerMessage to all connected WS clients.
   *  Defaults to a no-op; replaced by setupBroadcast() once the WS server
   *  is ready inside onAssistantAcceptsRequests. */
  broadcastWs: (msg: WsServerMessage) => void;

  /** Replaces the broadcastWs function. Call once the WS server is live. */
  setBroadcastWs: (fn: (msg: WsServerMessage) => void) => void;

  // ── UI extension state (registerScript / registerStylesheet) ───────

  registeredScripts: RegisteredUiExtension[];
  registeredScriptPaths: Set<string>;
  registeredStylesheetPaths: Set<string>;
  stylesheetUrlsByGroup: Map<string, string[]>;

  // ── MikroORM (assigned inside onAssistantAcceptsRequests) ──────────

  /** The MikroORM instance. `null` until onAssistantAcceptsRequests fires,
   *  so downstream code must guard or only be invoked after that hook. */
  orm: MikroORM | null;

  /** Assigns the ORM once the database is ready. */
  setOrm: (orm: MikroORM) => void;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createContext(opts: {
  logger: PluginLogger;
  onDatabaseReady: WebUiContext['onDatabaseReady'];
  app: Express;
}): WebUiContext {
  const ctx: WebUiContext = {
    logger: opts.logger,
    onDatabaseReady: opts.onDatabaseReady,
    app: opts.app,

    cachedChatConversations: new Map(),
    sessionOperationQueues: new Map(),
    pendingToolCallRounds: new Map(),

    broadcastWs: () => {},
    setBroadcastWs(fn) {
      ctx.broadcastWs = fn;
    },

    registeredScripts: [],
    registeredScriptPaths: new Set(),
    registeredStylesheetPaths: new Set(),
    stylesheetUrlsByGroup: new Map(),

    orm: null,
    setOrm(o) {
      ctx.orm = o;
    },
  };

  return ctx;
}
