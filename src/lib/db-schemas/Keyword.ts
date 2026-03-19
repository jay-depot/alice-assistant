import { defineEntity, p } from '@mikro-orm/sqlite';
import { Memory } from './Memory';

const KeywordSchema = defineEntity({
  name: 'Keyword',
  properties: {
    id: p.integer().primary(),
    keyword: p.string(),
    memories: () => p.manyToMany(Memory).mappedBy('keywords'),
  }
});

export class Keyword extends KeywordSchema.class {};

KeywordSchema.setClass(Keyword);
