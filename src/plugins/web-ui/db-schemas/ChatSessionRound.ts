import { defineEntity, p } from '@mikro-orm/sqlite';
import { ChatSession } from './ChatSession.js';

const ChatSessionRoundSchema = defineEntity({
  name: 'ChatSessionRound',
  properties: {
    id: p.integer().primary(),
    chatSession: () => p.manyToOne(ChatSession).fieldName('rounds'),
    role: p.enum(['user', 'assistant', 'system']),
    content: p.string(),
    timestamp: p.datetime(),
  }
});

export class ChatSessionRound extends ChatSessionRoundSchema.class {}

ChatSessionRoundSchema.setClass(ChatSessionRound);
