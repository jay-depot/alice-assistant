import { Type, Static } from 'typebox';

export const SystemConfigBasic = Type.Object({
  wakeWord: Type.String(),
  assistantName: Type.String(),
  location: Type.String(), // TODO: This needs to be moved into the static-location plugin config
  webInterface: Type.Object({
    enabled: Type.Boolean(),
    port: Type.Number(),
    bindToAddress: Type.String(),
  }),
  ollama: Type.Object({
    host: Type.String(),
    model: Type.String(),
    options: Type.Optional(Type.Object({
      think: Type.Optional(Type.Intersect([Type.Boolean(), Type.String()])),
      num_ctx: Type.Optional(Type.Number()),
      top_p: Type.Optional(Type.Number()),
      min_p: Type.Optional(Type.Number()),
      top_k: Type.Optional(Type.Number()),
      temperature: Type.Optional(Type.Number()),
    })),
  }),
  piperTts: Type.Object({
    host: Type.String(),
    model: Type.String(),
    speaker: Type.Number(),
  }),
});

export type SystemConfigBasic = Static<typeof SystemConfigBasic>;
