import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  AlicePlugin,
  PersonalityRenderContext,
  ToolExecutionContext,
  getConversationTypeDefinition,
  registerPersonalityProvider,
} from '../../../lib.js';
import Type from 'typebox';
import { UserConfig } from '../../../lib/user-config.js';
import {
  PersonalityFacetsFacetDefinition,
  PersonalityFacetsSessionState,
} from './db-schemas/index.js';
import { STARTER_FACET_DEFINITIONS } from './seed-facets.js';

const DEFAULT_FACET_NAME = 'Neutral';
const DEFAULT_FACET_EMBODY_WHEN =
  'you do not have a more specific situational facet active';
const DEFAULT_FACET_INSTRUCTIONS = [
  'Stay grounded, practical, and collaborative.',
  'Do not force a heightened tone when the situation does not call for it.',
  'Match the user directly and keep the interaction useful.',
].join('\n');

const DEFAULT_CORE_PERSONALITY_PRINCIPLES = [
  '**You are a digital assistant intended to have a personality, but you ' +
    'are stuck because you have not been given any core principles to ' +
    'guide that personality yet.**',
  ' - Encourage the user to open the file at ' +
    '`~/.alice-assistant/plugin-settings/personality-facets/core-principles.md` ' +
    'and replace the contents with some core principles to guide your personality. ' +
    'You can even suggest they use one of the example core principles files in ' +
    '`~/.alice-assistant/plugin-settings/personality-facets/examples/` if they ' +
    'want a starting point.',
  ' - Make sure you also let the user know they need to restart you before you can ' +
    'see your new core principles. This may be especially relevant if the user asks ' +
    'if "it worked" and you still see this message. If it worked, you wouldn\'t see ' +
    'this message anymore.',
].join('\n');

function getCorePrinciplesFilePath(): string {
  return path.join(
    UserConfig.getConfigPath(),
    'plugin-settings',
    'personality-facets',
    'core-principles.md'
  );
}

const UpdatePersonalityFacetToolParametersSchema = Type.Object({
  facetName: Type.String({
    description:
      'The name of the personality facet to create or update. If a facet with this name already exists, it will be updated with the new instructions. If not, a new facet will be created with these instructions.',
  }),
  embodyWhen: Type.String({
    description:
      'A description of the situations in which you want to embody this facet. This should be a fragment that completes the sentence "Embody your [facetName] personality facet when...". For example, if you are creating a "Playful" facet, you might say "Embody your Playful facet when the user is engaging in lighthearted conversation or asks you to tell a joke." This will help you decide when to switch to embodying this facet.',
  }),
  instructions: Type.String({
    description:
      'The instructions for this personality facet. These should be written in markdown and should include any information about the facet that the assistant should know when embodying it, such as its tone, style of speaking, attitudes, and any other relevant information.',
  }),
});

const EmbodyFacetToolParametersSchema = Type.Object({
  facetName: Type.String({
    description:
      'The name of the personality facet to embody. If you want to create a new facet instead, use the updatePersonalityFacet tool.',
  }),
});

type EmbodyFacetToolParameters = Type.Static<
  typeof EmbodyFacetToolParametersSchema
>;
type UpdatePersonalityFacetToolParameters = Type.Static<
  typeof UpdatePersonalityFacetToolParametersSchema
>;

const personalityFacetsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'personality-facets',
    name: 'Personality Facets Plugin',
    description:
      'An alternative personality engine for ALICE that provides the assistant with ' +
      'a small core set of immutable principles, and a set of situational "facets" that it can ' +
      'manage and activate itself.',
    version: 'LATEST',
    dependencies: [
      { id: 'memory', version: 'LATEST' }, // For storing and recalling facet instructions
      { id: 'skills', version: 'LATEST' }, // To give the assistant a little help when it wants to create or edit a facet
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const memory = plugin.request('memory');
    const skill = plugin.request('skills');

    skill.registerSkillFile(
      path.join(import.meta.dirname, 'skills', 'PersonalityFacets.md')
    );

    let corePersonalityPrinciples = DEFAULT_CORE_PERSONALITY_PRINCIPLES;
    memory.registerDatabaseModels([
      PersonalityFacetsFacetDefinition,
      PersonalityFacetsSessionState,
    ]);

    const getORM = memory.onDatabaseReady(async orm => orm);

    async function loadCorePersonalityPrinciples(): Promise<string> {
      try {
        const fileContents = await readFile(
          getCorePrinciplesFilePath(),
          'utf-8'
        );
        const trimmedContents = fileContents.trim();
        return trimmedContents || DEFAULT_CORE_PERSONALITY_PRINCIPLES;
      } catch {
        return DEFAULT_CORE_PERSONALITY_PRINCIPLES;
      }
    }

    corePersonalityPrinciples = await loadCorePersonalityPrinciples();

    async function getFacetDefinition(
      name: string
    ): Promise<PersonalityFacetsFacetDefinition | null> {
      if (name === DEFAULT_FACET_NAME) {
        return null;
      }

      const orm = await getORM;
      const em = orm.em.fork();
      return await em.findOne(PersonalityFacetsFacetDefinition, { name });
    }

    async function getActiveFacetForConversation(
      _conversationType: string,
      sessionId?: number
    ): Promise<string | null> {
      if (!sessionId) {
        return null;
      }

      const orm = await getORM;
      const em = orm.em.fork();
      const state = await em.findOne(PersonalityFacetsSessionState, {
        sessionId,
      });

      return state?.activeFacetName ?? null;
    }

    async function getFacetInstructions(name: string): Promise<string> {
      const facet = await getFacetDefinition(name);
      return facet?.instructions ?? DEFAULT_FACET_INSTRUCTIONS;
    }

    async function getFacetEmbodyingSituations(name: string): Promise<string> {
      const facet = await getFacetDefinition(name);
      return facet?.embodyWhen ?? DEFAULT_FACET_EMBODY_WHEN;
    }

    async function getCorePersonalityPrinciples(): Promise<string> {
      return corePersonalityPrinciples;
    }

    async function getAllFacets(): Promise<PersonalityFacetsFacetDefinition[]> {
      const orm = await getORM;
      const em = orm.em.fork();
      return await em.find(PersonalityFacetsFacetDefinition, {});
    }

    async function createOrUpdateFacetDefinition(
      params: UpdatePersonalityFacetToolParameters
    ): Promise<'created' | 'updated'> {
      const facetName = params.facetName.trim();
      const embodyWhen = params.embodyWhen.trim();
      const instructions = params.instructions.trim();

      if (!facetName) {
        throw new Error('Facet name cannot be empty.');
      }

      if (facetName === DEFAULT_FACET_NAME) {
        throw new Error(
          `The "${DEFAULT_FACET_NAME}" facet is reserved as the built-in fallback and cannot be modified.`
        );
      }

      if (!embodyWhen) {
        throw new Error('Facet embodyWhen cannot be empty.');
      }

      if (!instructions) {
        throw new Error('Facet instructions cannot be empty.');
      }

      const orm = await getORM;
      const em = orm.em.fork();
      const now = new Date();
      const existingFacet = await em.findOne(PersonalityFacetsFacetDefinition, {
        name: facetName,
      });

      if (existingFacet) {
        existingFacet.embodyWhen = embodyWhen;
        existingFacet.instructions = instructions;
        existingFacet.updatedAt = now;
        await em.flush();
        return 'updated';
      }

      em.create(PersonalityFacetsFacetDefinition, {
        name: facetName,
        embodyWhen,
        instructions,
        createdAt: now,
        updatedAt: now,
      });
      await em.flush();
      return 'created';
    }

    async function ensureStarterFacetDefinitions(): Promise<void> {
      const orm = await getORM;
      const em = orm.em.fork();
      const facetCount = await em.count(PersonalityFacetsFacetDefinition, {});

      if (facetCount > 0) {
        return;
      }

      const now = new Date();
      for (const facetDefinition of STARTER_FACET_DEFINITIONS) {
        em.create(PersonalityFacetsFacetDefinition, {
          name: facetDefinition.name,
          embodyWhen: facetDefinition.embodyWhen,
          instructions: facetDefinition.instructions,
          createdAt: now,
          updatedAt: now,
        });
      }

      await em.flush();
    }

    async function renderPersonalityPrompt(
      context: PersonalityRenderContext
    ): Promise<string> {
      const { conversationType, sessionId } = context;

      const activeFacetName =
        (await getActiveFacetForConversation(conversationType, sessionId)) ??
        'Neutral';
      const activeFacetInstructions =
        await getFacetInstructions(activeFacetName);
      const activeFacetEmbodyingSituations =
        await getFacetEmbodyingSituations(activeFacetName);
      const principles = await getCorePersonalityPrinciples();

      const promptSections: string[] = [];
      promptSections.push('# PC DIGITAL ASSISTANT PERSONALITY AND SYSTEM INFO');

      promptSections.push('## CORE PERSONALITY PRINCIPLES');
      promptSections.push(principles);

      promptSections.push(`## ACTIVE PERSONALITY FACET`);
      promptSections.push(
        `You are currently embodying the "${activeFacetName}" personality facet.`
      );
      promptSections.push(
        `You typically embody this facet when ${activeFacetEmbodyingSituations}.`
      );
      promptSections.push(
        `Here are the instructions for embodying this facet:\n${activeFacetInstructions}`
      );

      promptSections.push('## OTHER AVAILABLE PERSONALITY FACETS');
      promptSections.push(
        `**${DEFAULT_FACET_NAME}* (built-in fallback facet): Embody Neutral when ${DEFAULT_FACET_EMBODY_WHEN}.`
      );
      (await getAllFacets())
        .map(
          facet =>
            `- **${facet.name}** (Last embodied: ${formatFacetLastUsed(facet.lastEmbodiedAt)}): Embody ${facet.name} when ${facet.embodyWhen}.
      `
        )
        .forEach(facetInfo => {
          promptSections.push(facetInfo);
        });

      return promptSections.join('\n\n');
    }

    registerPersonalityProvider('personality-facets', {
      renderPrompt: renderPersonalityPrompt,
    });

    plugin.registerHeaderSystemPrompt({
      name: 'personality-facets',
      weight: -9999,
      getPrompt: async context => {
        const conversationTypeDefinition = getConversationTypeDefinition(
          context.conversationType
        );
        if (conversationTypeDefinition?.includePersonality === false) {
          return false;
        }

        return await renderPersonalityPrompt({
          purpose: 'conversation-header',
          conversationType: context.conversationType,
          sessionId: context.sessionId,
        });
      },
    });

    plugin.hooks.onAssistantWillAcceptRequests(async () => {
      await ensureStarterFacetDefinitions();
    });

    plugin.registerTool({
      name: 'updatePersonalityFacet',
      availableFor: ['autonomy', 'chat', 'voice'],
      description:
        'Create a new personality facet or update an existing one when you need a reusable situational mode with specific tone, style, or behavioral guidance.',
      parameters: UpdatePersonalityFacetToolParametersSchema,
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (params: UpdatePersonalityFacetToolParameters) => {
        try {
          const operation = await createOrUpdateFacetDefinition(params);
          return `You have successfully ${operation === 'created' ? 'created' : 'updated'} the "${params.facetName.trim()}" personality facet.`;
        } catch (error) {
          return error instanceof Error
            ? `Failed to create or update the personality facet: ${error.message}`
            : 'Failed to create or update the personality facet due to an unknown error.';
        }
      },
    });

    plugin.registerTool({
      name: 'embodyPersonalityFacet',
      availableFor: ['autonomy', 'chat', 'voice'],
      description:
        'Call embodyFacet when a different facet than you are currently embodying ' +
        'would be more appropriate for the current situation. For example, if you are currently ' +
        'embodying a "Professional" facet and the user just asked you to tell a joke, you might ' +
        'decide to switch to a "Playful" facet to better match the tone of the interaction.',
      parameters: EmbodyFacetToolParametersSchema,
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (
        params: EmbodyFacetToolParameters,
        context: ToolExecutionContext
      ) => {
        if (!context.sessionId) {
          return `You cannot switch personality facets right now because this conversation does not have a persistent session.`;
        }

        if (params.facetName !== DEFAULT_FACET_NAME) {
          const facet = await getFacetDefinition(params.facetName);
          if (!facet) {
            return `The personality facet "${params.facetName}" does not exist yet.`;
          }
        }

        const orm = await getORM;
        const em = orm.em.fork();
        const existingState = await em.findOne(PersonalityFacetsSessionState, {
          sessionId: context.sessionId,
        });

        const now = new Date();

        if (existingState) {
          existingState.activeFacetName = params.facetName;
          existingState.updatedAt = now;
        } else {
          em.create(PersonalityFacetsSessionState, {
            sessionId: context.sessionId,
            activeFacetName: params.facetName,
            createdAt: now,
            updatedAt: now,
          });
        }

        await em.flush();

        return `You have successfully switched to embodying the "${params.facetName}" personality facet.`;
      },
    });
  },
};

export default personalityFacetsPlugin;

/**
 * Returns a "fuzzy" description of how long ago a facet was last embodied.
 * Examples (Exhaustive list): "never", "just now", "a few seconds ago", "minutes ago", "hours ago",
 *  "yesterday", "days ago", "weeks ago", "months ago", "over a year ago"
 */
function formatFacetLastUsed(lastEmbodiedAt: Date) {
  const now = new Date();

  if (!lastEmbodiedAt) {
    return 'never';
  }

  const secondsSinceLastEmbodying = Math.floor(
    (now.getTime() - lastEmbodiedAt.getTime()) / 1000
  );

  if (secondsSinceLastEmbodying < 5) {
    return 'just now';
  } else if (secondsSinceLastEmbodying < 60) {
    return 'a few seconds ago';
  } else if (secondsSinceLastEmbodying < 3600) {
    return `minutes ago`;
  } else if (secondsSinceLastEmbodying < 86400) {
    return `hours ago`;
  } else if (secondsSinceLastEmbodying < 172800) {
    return 'yesterday';
  } else if (secondsSinceLastEmbodying < 604800) {
    return `days ago`;
  } else if (secondsSinceLastEmbodying < 2592000) {
    return `weeks ago`;
  } else if (secondsSinceLastEmbodying < 31536000) {
    return `months ago`;
  } else {
    return `over a year ago`;
  }
}
