import { defineEntity, p } from '@mikro-orm/sqlite';
import { MemoryKeywords } from './Keyword';

const MemorySchema = defineEntity({
  name: 'Memory',
  properties: {
    id: p.integer().primary(),
    timestamp: p.datetime(),
    content: p.string(),
    keywords: () => p.manyToMany(MemoryKeywords).mappedBy('memories'),
  }
});

export class Memory extends MemorySchema.class {};

MemorySchema.setClass(Memory);
