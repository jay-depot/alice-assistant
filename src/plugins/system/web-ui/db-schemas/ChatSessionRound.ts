import { defineEntity, p } from '@mikro-orm/sqlite';
import { ChatSession } from './ChatSession.js';

const ChatSessionRoundSchema = defineEntity({
  name: 'ChatSessionRound',
  properties: {
    id: p.integer().primary(),
    chatSession: () => p.manyToOne(ChatSession).fieldName('rounds'),
    role: p.enum(['user', 'assistant', 'system']),
    messageKind: p
      .enum(['chat', 'notification', 'tool_call'])
      .nullable()
      .default('chat'),
    content: p.string(),
    timestamp: p.datetime(),
    senderName: p.string().nullable().default(null),
    toolCallData: p.json().nullable().default(null),
  },
});

export class ChatSessionRound extends ChatSessionRoundSchema.class {}

ChatSessionRoundSchema.setClass(ChatSessionRound);
