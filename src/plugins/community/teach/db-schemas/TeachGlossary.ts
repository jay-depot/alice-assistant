import { defineEntity, p } from '@mikro-orm/sqlite';
import { TeachTopic } from './TeachTopic.js';

const TeachGlossarySchema = defineEntity({
  name: 'TeachGlossary',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    description: p.text(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export class TeachGlossary extends TeachGlossarySchema.class {}

TeachGlossarySchema.setClass(TeachGlossary);
