import { defineEntity, p } from '@mikro-orm/sqlite';

const PersonalityFacetsSessionStateSchema = defineEntity({
  name: 'PersonalityFacetsSessionState',
  properties: {
    id: p.integer().primary(),
    sessionId: p.integer(),
    activeFacetName: p.string(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  }
});

export class PersonalityFacetsSessionState extends PersonalityFacetsSessionStateSchema.class {
  declare id: number;
  declare sessionId: number;
  declare activeFacetName: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

PersonalityFacetsSessionStateSchema.setClass(PersonalityFacetsSessionState);
