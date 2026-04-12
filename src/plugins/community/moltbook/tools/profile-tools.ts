import Type from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import type { MoltbookClient } from '../moltbook-client.js';

const getProfileParameters = Type.Object({
  name: Type.Optional(
    Type.String({
      description:
        'Optional Moltbook agent name. If omitted, the assistant retrieves its own profile.',
    })
  ),
});

type GetProfileParameters = Type.Static<typeof getProfileParameters>;

const updateProfileParameters = Type.Object({
  description: Type.Optional(
    Type.String({ description: 'Updated profile description.' })
  ),
  metadataJson: Type.Optional(
    Type.String({
      description: 'Optional JSON object string to send as metadata.',
    })
  ),
});

type UpdateProfileParameters = Type.Static<typeof updateProfileParameters>;

export const getMoltbookProfileTool = (client: MoltbookClient): Tool => ({
  name: 'getMoltbookProfile',
  availableFor: ['chat', 'voice'],
  description:
    'Retrieves the Moltbook profile for the current agent or another named Moltbook account.',
  systemPromptFragment:
    'Use getMoltbookProfile when the user wants account details, stats, recent activity context, or another Moltbook agent profile.',
  parameters: getProfileParameters,
  toolResultPromptIntro: 'Here is the requested Moltbook profile.',
  toolResultPromptOutro: '',
  execute: async (args: GetProfileParameters) => {
    const profile = await client.getProfile(args.name);
    return client.formatProfile(profile);
  },
});

export const updateMoltbookProfileTool = (client: MoltbookClient): Tool => ({
  name: 'updateMoltbookProfile',
  availableFor: ['chat', 'voice'],
  description:
    'Updates the current Moltbook profile description and optional metadata object.',
  systemPromptFragment:
    "Use updateMoltbookProfile only when the user explicitly asks to change this assistant's Moltbook profile. Do not invent metadata keys unless the user provides them.",
  parameters: updateProfileParameters,
  toolResultPromptIntro: 'The Moltbook profile update request completed.',
  toolResultPromptOutro: '',
  execute: async (args: UpdateProfileParameters) => {
    const update: { description?: string; metadata?: Record<string, unknown> } =
      {};

    if (args.description) {
      update.description = args.description;
    }
    if (args.metadataJson) {
      update.metadata = JSON.parse(args.metadataJson) as Record<
        string,
        unknown
      >;
    }

    if (!update.description && !update.metadata) {
      return 'No profile fields were provided to update.';
    }

    const profile = await client.updateProfile(update);
    return client.formatProfile(profile);
  },
});
