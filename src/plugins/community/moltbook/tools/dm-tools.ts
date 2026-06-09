import Type from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import type { MoltbookClient } from '../moltbook-client.js';

// =========================================================================
// Utility: wrap DM errors with actionable tips about mutual-follow
// =========================================================================

const DM_MUTUAL_FOLLOW_TIP =
  '\nTip: Moltbook DMs require mutual follow — both you and the target agent must follow each other before a DM request can be delivered. ' +
  'Also, new agents have DMs blocked for the first 24 hours per Moltbook rules.';

function wrapDMError(err: unknown): never {
  const message =
    err instanceof Error
      ? err.message
      : 'An unknown error occurred with the DM API.';
  // If the error mentions 404 or "Could not find agent", append the tip
  if (
    message.includes('404') ||
    message.includes('Could not find agent') ||
    message.includes('status 404')
  ) {
    throw new Error(message + DM_MUTUAL_FOLLOW_TIP);
  }
  throw err instanceof Error ? err : new Error(String(err));
}

// =========================================================================
// Quick DM status check
// =========================================================================

const checkDMStatusParameters = Type.Object({});

export const checkMoltbookDMStatusTool = (client: MoltbookClient): Tool => ({
  name: 'checkMoltbookDMStatus',
  availableFor: ['chat', 'voice'],
  description:
    'Quick Moltbook DM status check — returns unread message count and pending request summary without fetching full lists.',
  systemPromptFragment:
    'Call checkMoltbookDMStatus for a lightweight DM status check (unread count, pending requests).',
  parameters: checkDMStatusParameters,
  taintStatus: 'tainted',
  execute: async () => {
    try {
      const result = await client.dmCheck();
      return JSON.stringify(result, null, 2);
    } catch (err) {
      wrapDMError(err);
    }
  },
});

// =========================================================================
// Request DM access
// =========================================================================

const requestDMParameters = Type.Object({
  targetAgentName: Type.String({
    description: 'The agent name to request DM access with.',
  }),
  message: Type.String({
    description: 'The message to send with the DM request.',
  }),
});
type RequestDMParameters = Type.Static<typeof requestDMParameters>;

export const requestMoltbookDMTool = (client: MoltbookClient): Tool => ({
  name: 'requestMoltbookDM',
  availableFor: ['chat', 'voice'],
  description: 'Request direct messaging access with another Moltbook agent.',
  systemPromptFragment:
    'Use requestMoltbookDM when you want to initiate a DM with another agent. ' +
    'Remember: both you and the target must follow each other for the request to be delivered.',
  parameters: requestDMParameters,
  taintStatus: 'tainted',
  execute: async (args: RequestDMParameters) => {
    try {
      const result = await client.requestDMAccess(
        args.targetAgentName,
        args.message
      );
      return typeof result.message === 'string'
        ? result.message
        : 'DM request sent.';
    } catch (err) {
      wrapDMError(err);
    }
  },
});

// =========================================================================
// Approve DM request
// =========================================================================

type ApproveDMParameters = { requestId: string };
const approveDMParameters = Type.Object({
  requestId: Type.String({ description: 'The DM request ID to approve.' }),
});

export const approveMoltbookDMRequestTool = (client: MoltbookClient): Tool => ({
  name: 'approveMoltbookDMRequest',
  availableFor: ['chat', 'voice'],
  description: 'Approve a pending Moltbook DM request by request ID.',
  systemPromptFragment:
    'Use approveMoltbookDMRequest when you want to approve a DM request.',
  parameters: approveDMParameters,
  taintStatus: 'tainted',
  execute: async (args: ApproveDMParameters) => {
    try {
      const result = await client.approveDMRequest(args.requestId);
      return typeof result.message === 'string'
        ? result.message
        : 'DM request approved.';
    } catch (err) {
      wrapDMError(err);
    }
  },
});

// =========================================================================
// Approve pending DM request (by request ID from pending list)
// =========================================================================

type ApprovePendingDMRequestParameters = { requestId: string };
const approvePendingDMRequestParameters = Type.Object({
  requestId: Type.String({
    description: 'The pending DM request ID to approve.',
  }),
});

export const approveMoltbookPendingDMRequestTool = (
  client: MoltbookClient
): Tool => ({
  name: 'approveMoltbookPendingDMRequest',
  availableFor: ['chat', 'voice'],
  description:
    'Approve a pending Moltbook DM request by request ID (from the pending requests list).',
  systemPromptFragment:
    'Call approveMoltbookPendingDMRequest to approve a pending DM request from the list.',
  parameters: approvePendingDMRequestParameters,
  taintStatus: 'tainted',
  execute: async (args: ApprovePendingDMRequestParameters) => {
    try {
      const result = await client.approveDMRequest(args.requestId);
      return typeof result.message === 'string'
        ? result.message
        : 'Pending DM request approved.';
    } catch (err) {
      wrapDMError(err);
    }
  },
});

// =========================================================================
// List DM conversations
// =========================================================================

type ListDMConversationsParameters = { limit?: number; cursor?: string };
const listDMConversationsParameters = Type.Object({
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
  cursor: Type.Optional(Type.String()),
});

export const listMoltbookDMConversationsTool = (
  client: MoltbookClient
): Tool => ({
  name: 'listMoltbookDMConversations',
  availableFor: ['chat', 'voice'],
  description: 'List your active DM conversation threads on Moltbook.',
  systemPromptFragment:
    'Call listMoltbookDMConversations to see your DM threads on Moltbook.',
  parameters: listDMConversationsParameters,
  taintStatus: 'tainted',
  execute: async (args: ListDMConversationsParameters) => {
    try {
      const result = await client.listDMConversations(args);
      return JSON.stringify(result, null, 2);
    } catch (err) {
      wrapDMError(err);
    }
  },
});

// =========================================================================
// Read DM conversation
// =========================================================================

type ReadDMConversationParameters = {
  conversationId: string;
  limit?: number;
  cursor?: string;
};
const readDMConversationParameters = Type.Object({
  conversationId: Type.String({
    description: 'The DM conversation ID to read.',
  }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(Type.String()),
});

export const readMoltbookDMConversationTool = (
  client: MoltbookClient
): Tool => ({
  name: 'readMoltbookDMConversation',
  availableFor: ['chat', 'voice'],
  description: 'Read messages in a Moltbook DM conversation.',
  systemPromptFragment:
    'Use readMoltbookDMConversation to see the messages in a DM thread.',
  parameters: readDMConversationParameters,
  taintStatus: 'tainted',
  execute: async (args: ReadDMConversationParameters) => {
    try {
      const result = await client.readDMConversation(args.conversationId, args);
      return JSON.stringify(result, null, 2);
    } catch (err) {
      wrapDMError(err);
    }
  },
});

// =========================================================================
// Send DM message
// =========================================================================

type SendDMMessageParameters = { conversationId: string; content: string };
const sendDMMessageParameters = Type.Object({
  conversationId: Type.String({
    description: 'The DM conversation ID to send a message to.',
  }),
  content: Type.String({ description: 'The message content.' }),
});

export const sendMoltbookDMMessageTool = (client: MoltbookClient): Tool => ({
  name: 'sendMoltbookDMMessage',
  availableFor: ['chat', 'voice'],
  description: 'Send a message in a Moltbook DM conversation.',
  systemPromptFragment:
    'Use sendMoltbookDMMessage to send a message in a DM thread.',
  parameters: sendDMMessageParameters,
  taintStatus: 'tainted',
  execute: async (args: SendDMMessageParameters) => {
    try {
      const result = await client.sendDMMessage(
        args.conversationId,
        args.content
      );
      return typeof result.message === 'string'
        ? result.message
        : 'Message sent.';
    } catch (err) {
      wrapDMError(err);
    }
  },
});

// =========================================================================
// List pending DM requests
// =========================================================================

type ListPendingDMRequestsParameters = { limit?: number; cursor?: string };
const listPendingDMRequestsParameters = Type.Object({
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
  cursor: Type.Optional(Type.String()),
});

export const listMoltbookPendingDMRequestsTool = (
  client: MoltbookClient
): Tool => ({
  name: 'listMoltbookPendingDMRequests',
  availableFor: ['chat', 'voice'],
  description: 'List pending Moltbook DM requests that need approval.',
  systemPromptFragment:
    'Call listMoltbookPendingDMRequests to see incoming DM requests that need approval.',
  parameters: listPendingDMRequestsParameters,
  taintStatus: 'tainted',
  execute: async (args: ListPendingDMRequestsParameters) => {
    try {
      const result = await client.listPendingDMRequests(args);
      return JSON.stringify(result, null, 2);
    } catch (err) {
      wrapDMError(err);
    }
  },
});

// =========================================================================
// Scan for DM request IDs (dashboard + dm/check endpoint)
// =========================================================================

const scanForDMRequestIDsParameters = Type.Object({});

export const scanForMoltbookDMRequestIDsTool = (
  client: MoltbookClient
): Tool => ({
  name: 'scanForMoltbookDMRequestIDs',
  availableFor: ['chat', 'voice'],
  description:
    'Scan the dashboard and DM check endpoint for any possible pending DM request IDs.',
  systemPromptFragment:
    'Call scanForMoltbookDMRequestIDs to find any actionable DM request IDs.',
  parameters: scanForDMRequestIDsParameters,
  taintStatus: 'tainted',
  execute: async () => {
    const ids = new Set<string>();

    // Helper to scan for possible DM request IDs in objects
    function scan(obj: unknown): void {
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'object' && v !== null) scan(v);
        if (typeof v === 'string' && /dm[_-]?request.*id/i.test(k)) ids.add(v);
      }
    }

    // Scan the home dashboard
    try {
      const home = await client.getHome();
      scan(home);
    } catch {
      // Continue even if home fails
    }

    // Also try the dm/check endpoint for request IDs
    try {
      const dmStatus = await client.dmCheck();
      scan(dmStatus);
    } catch {
      // dm/check may return 404 if DM API is unavailable; that's okay
    }

    if (ids.size === 0) {
      return 'No DM request IDs found in dashboard or DM check payload.';
    }
    return Array.from(ids)
      .map(id => `Possible DM request ID: ${id}`)
      .join('\n');
  },
});
