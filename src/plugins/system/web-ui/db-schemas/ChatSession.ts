import { defineEntity, p } from '@mikro-orm/sqlite';
import { ChatSessionRound } from './ChatSessionRound.js';

const ChatSessionSchema = defineEntity({
  name: 'ChatSession',
  properties: {
    id: p.integer().primary(),
    title: p.string(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
    rounds: () =>
      p
        .oneToMany(ChatSessionRound)
        .fieldName('chatSession')
        .mappedBy('chatSession')
        .orphanRemoval(true),
    /**
     * Serialized compacted conversation context (JSON array of {role, content} messages).
     * Persisted so that sessions can be restored with their compaction state intact,
     * avoiding the need to re-compact from scratch on reload.
     */
    compactedContext: p.json().nullable().default(null),
  },
});

export class ChatSession extends ChatSessionSchema.class {}

ChatSessionSchema.setClass(ChatSession);
