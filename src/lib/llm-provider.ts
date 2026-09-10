import type { TSchema } from 'typebox';
import type { SystemConfigFull } from './types/system-config-full.js';
import { systemLogger } from './system-logger.js';

export type LlmUseFor = string;

const FALLBACK_USE_FOR = 'fallback';
const VISION_USE_FOR = 'vision';

export type LlmToolCall = {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

export type LlmImageAttachment = {
  mimeType: string;
  dataUrl: string;
  name?: string;
};

export type LlmMessage = {
  role: string;
  content: string;
  images?: LlmImageAttachment[];
  reasoning?: string;
  tool_calls?: LlmToolCall[];
  tool_name?: string;
  tool_call_id?: string;
};

export type LlmProviderCapabilities = {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
};

export type LlmModelProperties = {
  supportsVision: boolean;
  contextWindow?: number;
};

export type LlmToolDefinition = {
  name: string;
  description: string;
  parameters: TSchema;
};

export type LlmChatRequest = {
  messages: LlmMessage[];
  tools?: unknown[];
};

export type LlmChatResponse = {
  message: LlmMessage;
};

export type LlmStreamChunk = {
  message?: Partial<Pick<LlmMessage, 'content' | 'reasoning' | 'tool_calls'>>;
  done?: boolean;
};

export type OllamaLlmModelConfig = {
  provider: 'ollama';
  useFor: LlmUseFor;
  model: string;
  supportsVision?: boolean;
  host: string;
  /** Top-level ChatRequest field in ollama-js / the Ollama API — NOT a sampler
   *  option. Controls reasoning/thinking output for supported models. */
  think?: boolean | 'high' | 'medium' | 'low';
  options?: {
    num_ctx?: number;
    top_p?: number;
    min_p?: number;
    top_k?: number;
    temperature?: number;
  };
};

export type OpenRouterLlmModelConfig = {
  provider: 'openrouter';
  useFor: LlmUseFor;
  model: string;
  supportsVision?: boolean;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  siteUrl?: string;
  siteName?: string;
};

export type LlmModelConfig = OllamaLlmModelConfig | OpenRouterLlmModelConfig;

export type LlmProviderRegistration = {
  id: LlmModelConfig['provider'];
  capabilities: LlmProviderCapabilities;
  chat: (
    request: LlmChatRequest,
    model: LlmModelConfig
  ) => Promise<LlmChatResponse>;
  chatStream?: (
    request: LlmChatRequest,
    model: LlmModelConfig
  ) => Promise<AsyncIterable<LlmStreamChunk>>;
  buildToolDefinitions?: (definitions: LlmToolDefinition[]) => unknown[];

  /** Async per-model property detection (vision capability, context window).
   *  Ollama reads this from /api/show; registry-style providers serve static
   *  tables. Implementations may throw; resolveLlmProviderForRequestAsync
   *  catches failures and defaults supportsVision to false for the request. */
  getModelProperties?: (model: LlmModelConfig) => Promise<LlmModelProperties>;
};

export type ActiveLlmProvider = {
  model: LlmModelConfig;
  provider: LlmProviderRegistration;
  resolvedUseFor: LlmUseFor;
  /** Detected model properties, attached by resolveLlmProviderForRequestAsync. */
  properties?: LlmModelProperties;
};

export type LlmRoutingContext = {
  requestedUseFor?: LlmUseFor;
  latestUserMessage?: string;
  hasVisionInput?: boolean;
  conversationType?: string;
};

export type LlmUseForRegistration = {
  id: LlmUseFor;
  description: string;
  tier?: 'task' | 'agent' | 'medium';
  priority?: number;
  qualifies?: (context: LlmRoutingContext) => boolean;
};

const registeredProviders = new Map<
  LlmModelConfig['provider'],
  LlmProviderRegistration
>();
const registeredUseFor = new Map<LlmUseFor, LlmUseForRegistration>([
  [
    FALLBACK_USE_FOR,
    {
      id: FALLBACK_USE_FOR,
      description: 'Default fallback route for all requests.',
      priority: -100000,
      qualifies: () => false,
    },
  ],
]);
let providerRegistrationClosed = false;
let useForRegistrationClosed = false;
let pendingUseForOverride: LlmUseFor | undefined;

/**
 * Set a useFor override that will be applied on the next provider resolution.
 * Typically called from tool execution to switch models mid-session.
 * Cleared automatically after one resolution via consumePendingUseForOverride().
 */
export function setPendingUseForOverride(useFor: LlmUseFor | undefined): void {
  pendingUseForOverride = useFor;
}

/**
 * Consume and clear the pending override. Called internally by
 * resolveLlmProviderForRequest so the override is single-shot.
 */
function consumePendingUseForOverride(): LlmUseFor | undefined {
  const value = pendingUseForOverride;
  pendingUseForOverride = undefined;
  return value;
}

export function clearLlmProviderRegistry(): void {
  pendingUseForOverride = undefined;
  registeredProviders.clear();
  registeredUseFor.clear();
  registeredUseFor.set(FALLBACK_USE_FOR, {
    id: FALLBACK_USE_FOR,
    description: 'Default fallback route for all requests.',
    priority: -100000,
    qualifies: () => false,
  });
  providerRegistrationClosed = false;
  useForRegistrationClosed = false;
}

export function registerLlmProvider(provider: LlmProviderRegistration): void {
  if (providerRegistrationClosed) {
    throw new Error(
      `Provider registration is closed. ${provider.id} tried to register too late.`
    );
  }

  if (registeredProviders.has(provider.id)) {
    throw new Error(
      `An LLM provider with id "${provider.id}" is already registered. Disable one of the conflicting provider plugins to continue.`
    );
  }

  registeredProviders.set(provider.id, provider);
}

export function closeLlmProviderRegistration(): void {
  providerRegistrationClosed = true;
  useForRegistrationClosed = true;
}

export function registerLlmUseFor(definition: LlmUseForRegistration): void {
  const normalizedId = definition.id.trim().toLowerCase();
  if (!normalizedId) {
    throw new Error('Cannot register an empty useFor ID.');
  }

  if (useForRegistrationClosed) {
    throw new Error(
      `useFor registration is closed. ${normalizedId} tried to register too late.`
    );
  }

  if (normalizedId === FALLBACK_USE_FOR) {
    throw new Error(
      'The fallback useFor route is reserved by core and cannot be re-registered by plugins.'
    );
  }

  if (registeredUseFor.has(normalizedId)) {
    throw new Error(
      `A useFor route with id "${normalizedId}" is already registered. Disable one of the conflicting route plugins to continue.`
    );
  }

  registeredUseFor.set(normalizedId, {
    ...definition,
    id: normalizedId,
    tier: definition.tier ?? 'medium',
    priority: definition.priority ?? 0,
  });
}

export function listRegisteredLlmUseFor(): LlmUseFor[] {
  return [...registeredUseFor.keys()];
}

export function getLlmUseFor(
  useFor: LlmUseFor
): LlmUseForRegistration | undefined {
  return registeredUseFor.get(useFor.trim().toLowerCase());
}

export function listRegisteredLlmProviders(): Array<
  LlmModelConfig['provider']
> {
  return [...registeredProviders.keys()];
}

export function getLlmProvider(
  providerId: LlmModelConfig['provider']
): LlmProviderRegistration | undefined {
  return registeredProviders.get(providerId);
}

export function requireLlmProvider(
  providerId: LlmModelConfig['provider']
): LlmProviderRegistration {
  const provider = getLlmProvider(providerId);
  if (!provider) {
    throw new Error(
      `No LLM provider plugin registered for "${providerId}". Enable the matching provider plugin or change llm.models[useFor=fallback].provider.`
    );
  }
  return provider;
}

export function getFallbackLlmModel(config: SystemConfigFull): LlmModelConfig {
  const fallbackModels = config.llm.models.filter(
    model => model.useFor === FALLBACK_USE_FOR
  );

  if (fallbackModels.length !== 1) {
    throw new Error(
      `Expected exactly one llm.models entry with useFor="fallback", but found ${fallbackModels.length}. Fix ~/.alice-assistant/alice.json to continue.`
    );
  }

  return fallbackModels[0];
}

function getSingleConfiguredModelByUseFor(
  config: SystemConfigFull,
  useFor: LlmUseFor
): LlmModelConfig | undefined {
  const normalizedUseFor = useFor.trim().toLowerCase();
  const matches = config.llm.models.filter(
    model => model.useFor.trim().toLowerCase() === normalizedUseFor
  );

  if (matches.length > 1) {
    throw new Error(
      `Expected at most one llm.models entry for useFor="${normalizedUseFor}", but found ${matches.length}.`
    );
  }

  return matches[0];
}

const TIER_ORDER: NonNullable<LlmUseForRegistration['tier']>[] = [
  'task',
  'agent',
  'medium',
];

function resolveQualifiedUseFor(
  context: LlmRoutingContext
): LlmUseFor | undefined {
  if (context.requestedUseFor) {
    return context.requestedUseFor.trim().toLowerCase();
  }

  for (const tier of TIER_ORDER) {
    const candidates = [...registeredUseFor.values()]
      .filter(
        definition =>
          definition.id !== FALLBACK_USE_FOR && definition.tier === tier
      )
      .sort((left, right) => {
        const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return left.id.localeCompare(right.id);
      });

    for (const candidate of candidates) {
      if (!candidate.qualifies) {
        continue;
      }
      if (candidate.qualifies(context)) {
        return candidate.id;
      }
    }
  }

  if (context.hasVisionInput) {
    return VISION_USE_FOR;
  }

  return undefined;
}

function visionFallbackNotSupportedError(fallbackModel: LlmModelConfig): Error {
  return new Error(
    `Vision input was provided, but fallback model ${fallbackModel.provider}:${fallbackModel.model} does not support vision. Configure a vision model or choose a fallback model/provider that supports vision.`
  );
}

function visionRouteNotConfiguredError(fallbackModel: LlmModelConfig): Error {
  return new Error(
    `Vision input matched useFor=vision, but no vision model is configured and fallback model ${fallbackModel.provider}:${fallbackModel.model} does not support vision.`
  );
}

function configuredVisionRouteNotCapableError(model: LlmModelConfig): Error {
  return new Error(
    `Configured vision route selected ${model.provider}:${model.model}, but it does not support vision input. Fix llm.models useFor=vision configuration.`
  );
}

function buildActiveProvider(
  model: LlmModelConfig,
  resolvedUseFor: LlmUseFor
): ActiveLlmProvider {
  return {
    model,
    provider: requireLlmProvider(model.provider),
    resolvedUseFor,
  };
}

export function validateConfiguredLlmUseFor(config: SystemConfigFull): void {
  const unknownUseFor = config.llm.models
    .map(model => model.useFor.trim().toLowerCase())
    .filter(useFor => useFor !== FALLBACK_USE_FOR)
    .filter(useFor => !registeredUseFor.has(useFor));

  if (unknownUseFor.length > 0) {
    throw new Error(
      `Unknown llm.models useFor values: ${unknownUseFor.join(', ')}. Enable the plugin that registers these routes or fix alice.json.`
    );
  }
}

export function resolveLlmProviderForRequest(
  config: SystemConfigFull,
  context: LlmRoutingContext = {}
): ActiveLlmProvider {
  const fallbackModel = getFallbackLlmModel(config);
  const fallbackProvider = buildActiveProvider(fallbackModel, FALLBACK_USE_FOR);

  const override = consumePendingUseForOverride();
  if (override) {
    const overrideModel = getSingleConfiguredModelByUseFor(config, override);
    if (overrideModel) {
      return buildActiveProvider(overrideModel, override);
    }
    // Override useFor has no configured model, fall back to normal resolution
  }

  const resolvedUseFor = resolveQualifiedUseFor(context);
  if (!resolvedUseFor || resolvedUseFor === FALLBACK_USE_FOR) {
    return fallbackProvider;
  }

  const configuredModel = getSingleConfiguredModelByUseFor(
    config,
    resolvedUseFor
  );
  if (!configuredModel) {
    return fallbackProvider;
  }

  return buildActiveProvider(configuredModel, resolvedUseFor);
}

export function getActiveLlmProvider(
  config: SystemConfigFull
): ActiveLlmProvider {
  return resolveLlmProviderForRequest(config, {
    requestedUseFor: FALLBACK_USE_FOR,
  });
}

export function getApproximateContextWindow(model: LlmModelConfig): number {
  if (model.provider === 'ollama') {
    return model.options?.num_ctx ?? 36000;
  }

  return 32000;
}

export function describeLlmModel(model: LlmModelConfig): string {
  return `${model.provider}:${model.model}`;
}

/**
 * Async provider resolution: routes via resolveLlmProviderForRequest (sync),
 * then detects per-model properties via the provider's getModelProperties and
 * enforces the vision guards using the precedence chain
 * config supportsVision > detected > false.
 *
 * Detection failures are warned about and default supportsVision to false for
 * this request; they are never cached (the next request retries detection).
 */
export async function resolveLlmProviderForRequestAsync(
  config: SystemConfigFull,
  context: LlmRoutingContext = {}
): Promise<ActiveLlmProvider> {
  const fallbackModel = getFallbackLlmModel(config);
  const active = resolveLlmProviderForRequest(config, context);

  let properties: LlmModelProperties | undefined;
  try {
    properties = await active.provider.getModelProperties?.(active.model);
  } catch (error) {
    systemLogger.warn(
      `LLM provider "${active.provider.id}" property detection failed for ` +
        `${describeLlmModel(active.model)}: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        'Defaulting supportsVision=false for this request.'
    );
  }

  const resolved: ActiveLlmProvider = { ...active, properties };
  const supportsVision =
    active.model.supportsVision ?? properties?.supportsVision ?? false;

  if (!context.hasVisionInput || supportsVision) {
    return resolved;
  }

  // Mirror the historical sync-guard semantics: only the configured vision
  // route and the fallback path are gated. A non-vision route that
  // legitimately won resolution (e.g. chat) was never gated.
  if (active.resolvedUseFor === VISION_USE_FOR) {
    throw configuredVisionRouteNotCapableError(active.model);
  }

  if (active.resolvedUseFor === FALLBACK_USE_FOR) {
    if (context.requestedUseFor?.trim().toLowerCase() === FALLBACK_USE_FOR) {
      throw visionFallbackNotSupportedError(fallbackModel);
    }
    // No vision model configured: resolution fell back to the fallback model.
    throw visionRouteNotConfiguredError(fallbackModel);
  }

  return resolved;
}
