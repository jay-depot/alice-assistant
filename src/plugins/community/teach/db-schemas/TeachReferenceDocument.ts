import { defineEntity, p } from '@mikro-orm/sqlite';
import { TeachTopic } from './TeachTopic.js';

const TeachReferenceDocumentSchema = defineEntity({
  name: 'TeachReferenceDocument',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    title: p.string(),
    slug: p.string(),
    htmlContent: p.text(),
    category: p.string(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export class TeachReferenceDocument
  extends TeachReferenceDocumentSchema.class {}

TeachReferenceDocumentSchema.setClass(TeachReferenceDocument);
