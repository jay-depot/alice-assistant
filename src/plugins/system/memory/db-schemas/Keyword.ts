import { defineEntity, p } from '@mikro-orm/sqlite';
import { Memory } from './Memory.js';

const KeywordSchema = defineEntity({
  name: 'Keyword',
  properties: {
    id: p.integer().primary(),
    keyword: p.string(),
    memories: () => p.manyToMany(Memory),
  },
});

export class Keyword extends KeywordSchema.class {}

KeywordSchema.setClass(Keyword);
