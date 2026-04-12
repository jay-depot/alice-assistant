import { defineEntity, p } from '@mikro-orm/sqlite';

const PersonalityFacetsFacetDefinitionSchema = defineEntity({
  name: 'PersonalityFacetsFacetDefinition',
  properties: {
    id: p.integer().primary(),
    name: p.string(),
    embodyWhen: p.string(),
    instructions: p.text(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
    lastEmbodiedAt: p.datetime().nullable(),
  },
});

export class PersonalityFacetsFacetDefinition
  extends PersonalityFacetsFacetDefinitionSchema.class
{
  declare id: number;
  declare name: string;
  declare embodyWhen: string;
  declare instructions: string;
  declare createdAt: Date;
  declare updatedAt: Date;
  declare lastEmbodiedAt: Date | null;
}

PersonalityFacetsFacetDefinitionSchema.setClass(
  PersonalityFacetsFacetDefinition
);
