import { defineEntity, p } from '@mikro-orm/sqlite';
import { TeachTopic } from './TeachTopic.js';

const TeachResourceSchema = defineEntity({
  name: 'TeachResource',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    category: p.string(),
    title: p.string(),
    url: p.string().nullable(),
    annotation: p.text(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export class TeachResource extends TeachResourceSchema.class {}

TeachResourceSchema.setClass(TeachResource);
