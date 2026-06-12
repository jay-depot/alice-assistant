// Port of Matt Pocock's "teach" skill (https://github.com/mattpocock/skills/tree/main/skills/productivity/teach)
// adapted for the A.L.I.C.E. Assistant plugin ecosystem.

import { defineEntity, p } from '@mikro-orm/sqlite';

const TeachTopicSchema = defineEntity({
  name: 'TeachTopic',
  properties: {
    id: p.integer().primary(),
    slug: p.string(),
    name: p.string(),
    active: p.boolean(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export class TeachTopic extends TeachTopicSchema.class {}

TeachTopicSchema.setClass(TeachTopic);
