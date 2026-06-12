import { defineEntity, p } from '@mikro-orm/sqlite';
import { TeachTopic } from './TeachTopic.js';

const TeachMissionSchema = defineEntity({
  name: 'TeachMission',
  properties: {
    id: p.integer().primary(),
    topic: () => p.manyToOne(TeachTopic),
    why: p.text(),
    successLooksLike: p.text(),
    constraints: p.text(),
    outOfScope: p.text(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export class TeachMission extends TeachMissionSchema.class {}

TeachMissionSchema.setClass(TeachMission);
