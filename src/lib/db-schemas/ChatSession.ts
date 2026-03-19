import { defineEntity, p } from '@mikro-orm/sqlite';
import { ChatSessionRound } from './ChatSessionRound';

const ChatSessionSchema = defineEntity({
  name: 'ChatSession',
  properties: {
    id: p.integer().primary(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
    rounds: () => p.oneToMany(ChatSessionRound).fieldName('chatSession').mappedBy('chatSession'),
  }
});

export class ChatSession extends ChatSessionSchema.class {};

ChatSessionSchema.setClass(ChatSession);
