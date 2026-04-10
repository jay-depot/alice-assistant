import { Type, Static } from 'typebox';
import { SystemConfigBasic } from './system-config-basic.js';

export const SystemConfigFull = Type.Intersect([
  SystemConfigBasic,
  Type.Object({
    configDirectory: Type.String(),
  }),
]);

export type SystemConfigFull = Static<typeof SystemConfigFull>;
