import { defineEntity, p } from '@mikro-orm/sqlite';

const ChatSessionSchema = defineEntity({
  name: 'ChatSession',
  properties: {
    id: p.integer().primary(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
    context: p.string(),
  }
});

export class ChatSession extends ChatSessionSchema.class {};

ChatSessionSchema.setClass(ChatSession);
