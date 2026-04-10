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

let activePersonalityProvider: PersonalityProvider | undefined;
let activePersonalityProviderOwner: string | undefined;

export function registerPersonalityProvider(
  pluginId: string,
  provider: PersonalityProvider,
): void {
  if (activePersonalityProviderOwner && activePersonalityProviderOwner !== pluginId) {
    throw new Error(
      `Plugin ${pluginId} attempted to register the personality provider, but that provider is already registered by ${activePersonalityProviderOwner}. Disable one of these plugins to fix your assistant.`,
    );
  }

  activePersonalityProvider = provider;
  activePersonalityProviderOwner = pluginId;
}

export async function renderPersonalityPrompt(context: PersonalityRenderContext): Promise<string> {
  if (!activePersonalityProvider || !activePersonalityProviderOwner) {
    throw new Error(
      'No personality provider is registered. Enable a personality provider plugin to render assistant personality prompts.',
    );
  }

  return await activePersonalityProvider.renderPrompt(context);
}

export function getActivePersonalityProviderOwner(): string | undefined {
  return activePersonalityProviderOwner;
}