import type { ConversationTypeId } from './conversation-types.js';

export type PersonalityRenderPurpose = 'conversation-header' | 'notification';

export type PersonalityRenderContext = {
  purpose: PersonalityRenderPurpose;
  conversationType?: ConversationTypeId;
  sessionId?: number;
};

export type PersonalityProvider = {
  renderPrompt: (context: PersonalityRenderContext) => Promise<string> | string;
};

const DEFAULT_MISSING_PERSONALITY_CONVERSATION_PROMPT = [
  '# PERSONALITY MODULE STATUS',
  'No personality provider is currently active.',
  'You were designed to work with a personality module, but none is enabled right now.',
  'Remain useful, clear, and collaborative anyway.',
  'If the user asks about your personality or why you seem generic, explain that they can enable a personality provider plugin such as "personality" or "personality-facets" in `~/.alice-assistant/plugin-settings/enabled-plugins.json` and then restart the assistant.',
  'Do not dwell on this unless the user asks or it is directly relevant.',
].join('\n\n');

const DEFAULT_MISSING_PERSONALITY_NOTIFICATION_PROMPT = [
  '# PERSONALITY MODULE STATUS',
  'No personality provider is currently active.',
  'Deliver this notification in a neutral, clear, concise assistant voice.',
].join('\n\n');

let fallbackPersonalityProvider: PersonalityProvider | undefined;
let fallbackPersonalityProviderOwner: string | undefined;
let activePersonalityProviderOverride: PersonalityProvider | undefined;
let activePersonalityProviderOverrideOwner: string | undefined;

export function registerFallbackPersonalityProvider(
  pluginId: string,
  provider: PersonalityProvider
): void {
  if (
    fallbackPersonalityProviderOwner &&
    fallbackPersonalityProviderOwner !== pluginId
  ) {
    throw new Error(
      `Plugin ${pluginId} attempted to register the fallback personality provider, but that provider is already registered by ${fallbackPersonalityProviderOwner}. Disable one of these plugins to fix your assistant.`
    );
  }

  fallbackPersonalityProvider = provider;
  fallbackPersonalityProviderOwner = pluginId;
}

export function registerPersonalityProvider(
  pluginId: string,
  provider: PersonalityProvider
): void {
  if (
    activePersonalityProviderOverrideOwner &&
    activePersonalityProviderOverrideOwner !== pluginId
  ) {
    throw new Error(
      `Plugin ${pluginId} attempted to register the active personality provider, but that provider is already registered by ${activePersonalityProviderOverrideOwner}. Disable one of these plugins to fix your assistant.`
    );
  }

  activePersonalityProviderOverride = provider;
  activePersonalityProviderOverrideOwner = pluginId;
}

export async function renderPersonalityPrompt(
  context: PersonalityRenderContext
): Promise<string> {
  const provider =
    activePersonalityProviderOverride ?? fallbackPersonalityProvider;
  const providerOwner =
    activePersonalityProviderOverrideOwner ?? fallbackPersonalityProviderOwner;

  if (!provider || !providerOwner) {
    return context.purpose === 'notification'
      ? DEFAULT_MISSING_PERSONALITY_NOTIFICATION_PROMPT
      : DEFAULT_MISSING_PERSONALITY_CONVERSATION_PROMPT;
  }

  return await provider.renderPrompt(context);
}

export function getActivePersonalityProviderOwner(): string | undefined {
  return (
    activePersonalityProviderOverrideOwner ?? fallbackPersonalityProviderOwner
  );
}

export function getFallbackPersonalityProviderOwner(): string | undefined {
  return fallbackPersonalityProviderOwner;
}

export function getActivePersonalityProviderOverrideOwner():
  | string
  | undefined {
  return activePersonalityProviderOverrideOwner;
}
