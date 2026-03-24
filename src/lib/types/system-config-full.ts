import { Type, Static } from '@sinclair/typebox';
import { SystemConfigBasic } from './system-config-basic.js';

export const SystemConfigFull = Type.Intersect([
  SystemConfigBasic,
  Type.Object({
    configDirectory: Type.String(),
    personality: Type.Record(Type.String(), Type.String()),
    tools: Type.Optional(Type.Record(Type.String(), Type.Object({
      enabled: Type.Boolean(),
      config: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }))),
    enabledTools: Type.Optional(Type.Record(Type.String(), Type.Boolean())),
    toolSettings: Type.Optional(Type.Record(Type.String(), Type.Any())),
  }),
]);

export type SystemConfigFull = Static<typeof SystemConfigFull>;
