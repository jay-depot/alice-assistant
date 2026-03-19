import { defineEntity, p } from '@mikro-orm/sqlite';
import { Memory } from './Memory';

const MemoryKeywordsSchema = defineEntity({
  name: 'MemoryKeywords',
  properties: {
    id: p.integer().primary(),
    keyword: p.string(),
    memories: () => p.manyToMany(Memory).mappedBy('keywords'),
  }
});

export class MemoryKeywords extends MemoryKeywordsSchema.class {};

MemoryKeywordsSchema.setClass(MemoryKeywords);
