import Type from 'typebox';
import type { Tool } from '../../../lib/tool-system.js';
import type { MoltbookClient } from '../moltbook-client.js';

// Request DM access
type RequestDMParameters = { targetAgentName: string };
const requestDMParameters = Type.Object({
  targetAgentName: Type.String({ description: 'The agent name to request DM access with.' }),
});

export const requestMoltbookDMTool = (client: MoltbookClient): Tool => ({
  name: 'requestMoltbookDM',
  availableFor: ['chat', 'voice'],
  description: 'Request direct messaging access with another Moltbook agent.',
  systemPromptFragment: 'Use requestMoltbookDM when the user wants to initiate a DM with another agent.',
  parameters: requestDMParameters,
  toolResultPromptIntro: 'DM request result:',
  toolResultPromptOutro: '',
  execute: async (args: RequestDMParameters) => {
    const result = await client.requestDMAccess(args.targetAgentName);
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
  systemPromptFragment: 'Use approveMoltbookDMRequest when the user wants to approve a DM request.',
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
  description: 'List Moltbook DM conversations for the current agent.',
  systemPromptFragment: 'Use listMoltbookDMConversations to show the user their DM threads.',
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
  systemPromptFragment: 'Use readMoltbookDMConversation to show the user the messages in a DM thread.',
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
