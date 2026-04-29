import { defineEntity, p } from '@mikro-orm/sqlite';
import { ChatSession } from './ChatSession.js';

const ChatSessionRoundSchema = defineEntity({
  name: 'ChatSessionRound',
  properties: {
    id: p.integer().primary(),
    chatSession: () => p.manyToOne(ChatSession).fieldName('rounds'),
    role: p.enum(['user', 'assistant', 'system', 'tool']),
    messageKind: p
      .enum(['chat', 'notification', 'tool_call'])
      .nullable()
      .default('chat'),
    content: p.string(),
    reasoning: p.string().nullable().default(null),
    timestamp: p.datetime(),
    senderName: p.string().nullable().default(null),
    toolCallData: p.json().nullable().default(null),
    toolName: p.string().nullable().default(null),
  },
});

export class ChatSessionRound extends ChatSessionRoundSchema.class {}

ChatSessionRoundSchema.setClass(ChatSessionRound);
