import { defineEntity, p } from '@mikro-orm/sqlite';
import { TeachTopic } from './TeachTopic.js';

const TeachLessonSchema = defineEntity({
  name: 'TeachLesson',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    sequenceNumber: p.integer(),
    title: p.string(),
    slug: p.string(),
    htmlContent: p.text(),
    primarySourceTitle: p.string().nullable(),
    primarySourceUrl: p.string().nullable(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export class TeachLesson extends TeachLessonSchema.class {}

TeachLessonSchema.setClass(TeachLesson);
