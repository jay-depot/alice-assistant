import { defineEntity, p } from '@mikro-orm/sqlite';
import { TeachTopic } from './TeachTopic.js';

const TeachLearningRecordSchema = defineEntity({
  name: 'TeachLearningRecord',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    sequenceNumber: p.integer(),
    title: p.string(),
    body: p.text(),
    status: p.string(),
    evidence: p.text().nullable(),
    implications: p.text().nullable(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export class TeachLearningRecord extends TeachLearningRecordSchema.class {}

TeachLearningRecordSchema.setClass(TeachLearningRecord);
