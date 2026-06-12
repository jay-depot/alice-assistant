import { defineEntity, p } from '@mikro-orm/sqlite';
import { TeachGlossary } from './TeachGlossary.js';

const TeachGlossaryTermSchema = defineEntity({
  name: 'TeachGlossaryTerm',
  properties: {
    id: p.integer().primary(),
    glossary: () => p.manyToOne(TeachGlossary),
    term: p.string(),
    definition: p.text(),
    avoidList: p.text(),
    groupHeading: p.string().nullable(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export class TeachGlossaryTerm extends TeachGlossaryTermSchema.class {}

TeachGlossaryTermSchema.setClass(TeachGlossaryTerm);
