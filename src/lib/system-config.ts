import { Type, Static } from '@sinclair/typebox';

export const SystemConfig = Type.Object({
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
      num_ctx: Type.Optional(Type.Number()),
      top_p: Type.Optional(Type.Number()),
      min_p: Type.Optional(Type.Number()),
      top_k: Type.Optional(Type.Number()),
      temperature: Type.Optional(Type.Number()),
    })),
  }),
});

export type SystemConfig = Static<typeof SystemConfig>;
