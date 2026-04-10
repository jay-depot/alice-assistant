// Scan dashboard and notifications for possible DM request IDs
type ScanForDMRequestIDsParameters = {};
const scanForDMRequestIDsParameters = Type.Object({});

export const scanForMoltbookDMRequestIDsTool = (client: MoltbookClient): Tool => ({
  name: 'scanForMoltbookDMRequestIDs',
  availableFor: ['chat', 'voice'],
  description: 'Scan the dashboard and notifications for any possible pending DM request IDs.',
  systemPromptFragment: 'Call scanForMoltbookDMRequestIDs to try to find any actionable DM request IDs in the dashboard or notifications payloads.',
  parameters: scanForDMRequestIDsParameters,
  toolResultPromptIntro: 'Here are any DM request IDs found in the dashboard or notifications:',
  toolResultPromptOutro: '',
  execute: async () => {
    const home = await client.getHome();
    const ids = new Set();

    // Helper to scan for possible DM request IDs in objects
    function scan(obj: any) {
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'object') scan(v);
        if (typeof v === 'string' && /dm[_-]?request.*id/i.test(k)) ids.add(v);
      }
    }

    scan(home);

    if (ids.size === 0) {
      return 'No DM request IDs found in dashboard payload.';
    }
    return Array.from(ids).map(id => `Possible DM request ID: ${id}`).join('\n');
  },
});
// Approve pending DM request (by request ID from pending list)
type ApprovePendingDMRequestParameters = { requestId: string };
const approvePendingDMRequestParameters = Type.Object({
  requestId: Type.String({ description: 'The pending DM request ID to approve.' }),
});

export const approveMoltbookPendingDMRequestTool = (client: MoltbookClient): Tool => ({
  name: 'approveMoltbookPendingDMRequest',
  availableFor: ['chat', 'voice'],
  description: 'Approve a pending Moltbook DM request by request ID (from the pending requests list).',
  systemPromptFragment: 'Call approveMoltbookPendingDMRequest to approve a pending DM request from the list.',
  parameters: approvePendingDMRequestParameters,
  toolResultPromptIntro: 'Pending DM request approval result:',
  toolResultPromptOutro: '',
  execute: async (args: ApprovePendingDMRequestParameters) => {
    const result = await client.approveDMRequest(args.requestId);
    return typeof result.message === 'string' ? result.message : 'Pending DM request approved.';
  },
});
// List pending DM requests
type ListPendingDMRequestsParameters = { limit?: number; cursor?: string };
const listPendingDMRequestsParameters = Type.Object({
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
  cursor: Type.Optional(Type.String()),
});

export const listMoltbookPendingDMRequestsTool = (client: MoltbookClient): Tool => ({
  name: 'listMoltbookPendingDMRequests',
  availableFor: ['chat', 'voice'],
  description: 'List pending Moltbook DM requests that need approval.',
  systemPromptFragment: 'Call listMoltbookPendingDMRequests to see incoming DM requests that need approval.',
  parameters: listPendingDMRequestsParameters,
  toolResultPromptIntro: 'Here are your pending Moltbook DM requests:',
  toolResultPromptOutro: '',
  execute: async (args: ListPendingDMRequestsParameters) => {
    const result = await client.listPendingDMRequests(args);
    // TODO: Add formatting helper for pending DM requests
    return JSON.stringify(result, null, 2);
  },
});
import Type from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import type { MoltbookClient } from '../moltbook-client.js';

// Request DM access
const requestDMParameters = Type.Object({
  targetAgentName: Type.String({ description: 'The agent name to request DM access with.' }),
  message: Type.String({ description: 'The message to send with the DM request.' }),
});
type RequestDMParameters = Type.Static<typeof requestDMParameters>;

export const requestMoltbookDMTool = (client: MoltbookClient): Tool => ({
  name: 'requestMoltbookDM',
  availableFor: ['chat', 'voice'],
  description: 'Request direct messaging access with another Moltbook agent.',
  systemPromptFragment: 'Use requestMoltbookDM when you want to initiate a DM with another agent.',
  parameters: requestDMParameters,
  toolResultPromptIntro: 'DM request result:',
  toolResultPromptOutro: '',
  execute: async (args: RequestDMParameters) => {
    const result = await client.requestDMAccess(args.targetAgentName, args.message);
    return typeof result.message === 'string' ? result.message : 'DM request sent.';
  },
});

// Approve DM request
type ApproveDMParameters = { requestId: string };
const approveDMParameters = Type.Object({
  requestId: Type.String({ description: 'The DM request ID to approve.' }),
});

export const approveMoltbookDMRequestTool = (client: MoltbookClient): Tool => ({
  name: 'approveMoltbookDMRequest',
  availableFor: ['chat', 'voice'],
  description: 'Approve a pending Moltbook DM request by request ID.',
  systemPromptFragment: 'Use approveMoltbookDMRequest when you want to approve a DM request.',
  parameters: approveDMParameters,
  toolResultPromptIntro: 'DM approval result:',
  toolResultPromptOutro: '',
  execute: async (args: ApproveDMParameters) => {
    const result = await client.approveDMRequest(args.requestId);
    return typeof result.message === 'string' ? result.message : 'DM request approved.';
  },
});

// List DM conversations
type ListDMConversationsParameters = { limit?: number; cursor?: string };
const listDMConversationsParameters = Type.Object({
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
  cursor: Type.Optional(Type.String()),
});

export const listMoltbookDMConversationsTool = (client: MoltbookClient): Tool => ({
  name: 'listMoltbookDMConversations',
  availableFor: ['chat', 'voice'],
  description: 'Call listMoltbookDMConversations to see your DM threads on Moltbook.',
  systemPromptFragment: 'Call listMoltbookDMConversations to see your DM threads on Moltbook.',
  parameters: listDMConversationsParameters,
  toolResultPromptIntro: 'Here are your Moltbook DM conversations:',
  toolResultPromptOutro: '',
  execute: async (args: ListDMConversationsParameters) => {
    const result = await client.listDMConversations(args);
    // TODO: Add formatting helper for DMs
    return JSON.stringify(result, null, 2);
  },
});

// Read DM conversation
type ReadDMConversationParameters = { conversationId: string; limit?: number; cursor?: string };
const readDMConversationParameters = Type.Object({
  conversationId: Type.String({ description: 'The DM conversation ID to read.' }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(Type.String()),
});

export const readMoltbookDMConversationTool = (client: MoltbookClient): Tool => ({
  name: 'readMoltbookDMConversation',
  availableFor: ['chat', 'voice'],
  description: 'Read messages in a Moltbook DM conversation.',
  systemPromptFragment: 'Use readMoltbookDMConversation to see the messages in a DM thread.',
  parameters: readDMConversationParameters,
  toolResultPromptIntro: 'Here are the messages in this DM conversation:',
  toolResultPromptOutro: '',
  execute: async (args: ReadDMConversationParameters) => {
    const result = await client.readDMConversation(args.conversationId, args);
    // TODO: Add formatting helper for DMs
    return JSON.stringify(result, null, 2);
  },
});

// Send DM message
type SendDMMessageParameters = { conversationId: string; content: string };
const sendDMMessageParameters = Type.Object({
  conversationId: Type.String({ description: 'The DM conversation ID to send a message to.' }),
  content: Type.String({ description: 'The message content.' }),
});

export const sendMoltbookDMMessageTool = (client: MoltbookClient): Tool => ({
  name: 'sendMoltbookDMMessage',
  availableFor: ['chat', 'voice'],
  description: 'Send a message in a Moltbook DM conversation.',
  systemPromptFragment: 'Use sendMoltbookDMMessage to send a message in a DM thread.',
  parameters: sendDMMessageParameters,
  toolResultPromptIntro: 'DM message send result:',
  toolResultPromptOutro: '',
  execute: async (args: SendDMMessageParameters) => {
    const result = await client.sendDMMessage(args.conversationId, args.content);
    return typeof result.message === 'string' ? result.message : 'Message sent.';
  },
});
