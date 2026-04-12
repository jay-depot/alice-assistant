import { defineEntity, p } from '@mikro-orm/sqlite';
import { Keyword } from './Keyword.js';

const MemorySchema = defineEntity({
  name: 'Memory',
  properties: {
    id: p.integer().primary(),
    timestamp: p.datetime(),
    content: p.string(),
    keywords: () => p.manyToMany(Keyword).mappedBy('memories'),
  },
});

export class Memory extends MemorySchema.class {}

MemorySchema.setClass(Memory);
