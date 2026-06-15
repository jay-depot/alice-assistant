import { Type, Static } from 'typebox';

const OllamaLlmModelConfig = Type.Object({
  provider: Type.Literal('ollama'),
  useFor: Type.String({ minLength: 1 }),
  model: Type.String(),
  supportsVision: Type.Optional(Type.Boolean()),
  host: Type.String(),
  options: Type.Optional(
    Type.Object({
      think: Type.Optional(Type.Union([Type.Boolean(), Type.String()])),
      num_ctx: Type.Optional(Type.Number()),
      top_p: Type.Optional(Type.Number()),
      min_p: Type.Optional(Type.Number()),
      top_k: Type.Optional(Type.Number()),
      temperature: Type.Optional(Type.Number()),
    })
  ),
});

const OpenRouterLlmModelConfig = Type.Object({
  provider: Type.Literal('openrouter'),
  useFor: Type.String({ minLength: 1 }),
  model: Type.String(),
  supportsVision: Type.Optional(Type.Boolean()),
  apiKey: Type.Optional(Type.String()),
  baseUrl: Type.Optional(Type.String()),
  temperature: Type.Optional(Type.Number()),
  topP: Type.Optional(Type.Number()),
  maxTokens: Type.Optional(Type.Number()),
  siteUrl: Type.Optional(Type.String()),
  siteName: Type.Optional(Type.String()),
});

export const SystemConfigBasic = Type.Object({
  wakeWord: Type.String(),
  assistantName: Type.String(),
  displayName: Type.Optional(Type.String()),
  webInterface: Type.Object({
    enabled: Type.Boolean(),
    port: Type.Number(),
    bindToAddress: Type.String(),
  }),
  llm: Type.Object({
    models: Type.Array(
      Type.Union([OllamaLlmModelConfig, OpenRouterLlmModelConfig]),
      { minItems: 1 }
    ),
  }),
  piperTts: Type.Object({
    host: Type.String(),
    model: Type.String(),
    speaker: Type.Number(),
  }),
  openWakeWord: Type.Object({
    model: Type.String(),
  }),
});

export type SystemConfigBasic = Static<typeof SystemConfigBasic>;
