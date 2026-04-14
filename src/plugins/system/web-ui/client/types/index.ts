import type { ComponentType } from 'react';

export type MessageRole = 'user' | 'assistant';
export type MessageKind = 'chat' | 'notification' | 'tool_call';

export interface ToolCallData {
  /** UUID — groups tool calls from the same Promise.all batch. */
  callBatchId: string;
  toolName: string;
  status: 'running' | 'completed' | 'error';
  resultSummary?: string;
  error?: string;
  requiresApproval?: boolean;
  /** Set when the tool call originated from a task assistant sub-conversation. */
  taskAssistantId?: string;
  /** Set when the tool call originated from a session-linked agent conversation. */
  agentName?: string;
}

export interface Message {
  role: MessageRole;
  messageKind: MessageKind;
  content: string;
  timestamp: string;
  senderName?: string | null;
  toolCallData?: ToolCallData; // present when messageKind === 'tool_call'
}

export interface ActiveSessionAgent {
  instanceId: string;
  agentId: string;
  agentName: string;
  status: 'running' | 'cancelled' | 'erroring' | 'completed';
  startedAt: string;
  pendingMessageCount: number;
}

export interface Session {
  id: number | string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  activeAgents: ActiveSessionAgent[];
}

export interface SessionSummary {
  id: number | string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
}

export type UIRegion =
  | 'sidebar-top'
  | 'sidebar-bottom'
  | 'chat-header'
  | 'message-prefix'
  | 'message-suffix'
  | 'input-prefix'
  | 'settings-panel';

export interface ExtensionRouteDefinition {
  path: string;
  title?: string;
}

export interface ExtensionRegistration {
  id?: string;
  scriptUrl?: string;
  styleUrls: string[];
  regions?: UIRegion[];
  routes?: ExtensionRouteDefinition[];
}

export interface PluginClientRoute extends ExtensionRouteDefinition {
  component: ComponentType;
}

export interface AliceUIExtensionApi {
  registerComponent: (region: UIRegion, component: ComponentType) => void;
  registerRoute: (route: PluginClientRoute) => void;
}

export interface PluginClientExport {
  regions?: Partial<Record<UIRegion, ComponentType>>;
  routes?: PluginClientRoute[];
  onAliceUIReady?: (api: AliceUIExtensionApi) => void | Promise<void>;
}
