import { defineEntity, p } from '@mikro-orm/sqlite';

const AgentsCheckpointSchema = defineEntity({
  name: 'AgentsCheckpoint',
  properties: {
    id: p.integer().primary(),
    agentId: p.string(),
    pluginId: p.string(),
    agentName: p.string(),
    description: p.string(),
    conversationType: p.string(),
    status: p.string(),
    statusMessage: p.string().nullable().default(null),
    frozenState: p.json().nullable().default(null),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export class AgentsCheckpoint extends AgentsCheckpointSchema.class {
  declare id: number;
  declare agentId: string;
  declare pluginId: string;
  declare agentName: string;
  declare description: string;
  declare conversationType: string;
  declare status: string;
  declare statusMessage: string | null;
  declare frozenState: Record<string, unknown> | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

AgentsCheckpointSchema.setClass(AgentsCheckpoint);
