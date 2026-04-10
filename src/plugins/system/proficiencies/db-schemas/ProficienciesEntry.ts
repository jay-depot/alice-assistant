import { defineEntity, p } from '@mikro-orm/sqlite';

const ProficienciesEntrySchema = defineEntity({
  name: 'ProficienciesEntry',
  properties: {
    id: p.integer().primary(),
    name: p.string(),
    normalizedName: p.string(),
    recallWhen: p.string(),
    contents: p.string(),
    usageCount: p.integer(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
    lastAccessedAt: p.datetime(),
  }
});

export class ProficienciesEntry extends ProficienciesEntrySchema.class {}

ProficienciesEntrySchema.setClass(ProficienciesEntry);