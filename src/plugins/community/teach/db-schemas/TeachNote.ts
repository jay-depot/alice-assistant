import { defineEntity, p } from '@mikro-orm/sqlite';
import { TeachTopic } from './TeachTopic.js';

const TeachNoteSchema = defineEntity({
  name: 'TeachNote',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    content: p.text(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export class TeachNote extends TeachNoteSchema.class {}

TeachNoteSchema.setClass(TeachNote);
