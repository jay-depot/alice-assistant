import { MikroORM } from '@mikro-orm/sqlite';
import { Static, Type } from 'typebox';
import path from 'node:path';
import { AlicePlugin } from '../../../lib.js';
import { ProficienciesEntry } from './db-schemas/ProficienciesEntry.js';
import { resolveContents } from '../../../lib/diff-resolver.js';

const DAYS = 1000 * 60 * 60 * 24;

const ProficienciesPluginConfigSchema = Type.Object({
  maxProficiencies: Type.Number({ default: 30, minimum: 1, maximum: 1000 }),
});

type ProficienciesPluginConfigSchema = Static<
  typeof ProficienciesPluginConfigSchema
>;

const RecallProficiencyParametersSchema = Type.Object({
  proficiencyName: Type.String({
    description: 'The PascalCase name of the proficiency to recall.',
  }),
});

type RecallProficiencyParameters = Static<
  typeof RecallProficiencyParametersSchema
>;

const CreateProficiencyParametersSchema = Type.Object({
  proficiencyName: Type.String({
    description: 'The PascalCase name of the proficiency to create.',
  }),
  recallWhen: Type.String({
    description:
      'A short fragment describing when this proficiency should be recalled.',
  }),
  contents: Type.String({
    description:
      'The proficiency contents. This may be empty if you are creating a placeholder to update later.',
  }),
});

type CreateProficiencyParameters = Static<
  typeof CreateProficiencyParametersSchema
>;

const UpdateProficiencyParametersSchema = Type.Object({
  proficiencyName: Type.String({
    description: 'The PascalCase name of the proficiency to update.',
  }),
  recallWhen: Type.Optional(
    Type.String({ description: 'Updated recall trigger for the proficiency.' })
  ),
  contents: Type.Optional(
    Type.String({
      description:
        'Updated proficiency contents. Prefer format=diff with a unified diff patch for targeted edits.',
    })
  ),
  format: Type.Optional(
    Type.Union([
      Type.Literal('full', {
        description:
          'The contents field contains the complete new proficiency contents.',
      }),
      Type.Literal('diff', {
        description:
          'The contents field contains a unified diff patch to apply to the existing contents. ' +
          'Re-call recallProficiency first to get the current content, then produce a diff. ' +
          'Prefer this over format=full for updates.',
      }),
    ])
  ),
});

type UpdateProficiencyParameters = Static<
  typeof UpdateProficiencyParametersSchema
>;

function normalizeProficiencyName(name: string) {
  return name.trim().toLowerCase();
}

function validateProficiencyName(name: string) {
  return name.trim();
}

function validateRecallWhen(recallWhen: string) {
  return recallWhen.trim();
}

const DEFAULT_PROFICIENCY = {
  name: 'ProficienciesWelcome',
  recallWhen:
    'you need a quick refresher on how to use your proficiencies effectively',
  contents:
    'Proficiencies are self-managed, reusable notes for tasks and topics you handle repeatedly. Create them, keep them current, and proactively recall the ones that match the current work.',
} as const;

function sortLeastUsefulFirst(entries: ProficienciesEntry[]) {
  return [...entries].sort((left, right) => {
    const now = Date.now();
    const leftNormalizedUsageCount =
      left.usageCount / (1 + (now - left.createdAt.getTime()) / DAYS);
    const rightNormalizedUsageCount =
      right.usageCount / (1 + (now - right.createdAt.getTime()) / DAYS);
    if (leftNormalizedUsageCount !== rightNormalizedUsageCount) {
      return leftNormalizedUsageCount - rightNormalizedUsageCount;
    }

    const leftLastAccessed = left.lastAccessedAt.getTime();
    const rightLastAccessed = right.lastAccessedAt.getTime();
    if (leftLastAccessed !== rightLastAccessed) {
      return leftLastAccessed - rightLastAccessed;
    }

    return left.createdAt.getTime() - right.createdAt.getTime();
  });
}

function formatProficiency(entry: ProficienciesEntry) {
  return [
    `# ${entry.name}`,
    `Recall this proficiency when ${entry.recallWhen}`,
    '',
    entry.contents.trim() || '(This proficiency is currently empty.)',
  ].join('\n');
}

async function enforceProficiencyLimit(
  orm: MikroORM,
  maxProficiencies: number,
  protectedNormalizedName?: string
) {
  const em = orm.em.fork();
  const proficiencies = await em.find(ProficienciesEntry, {});

  if (proficiencies.length <= maxProficiencies) {
    return null;
  }

  const entryToRemove = sortLeastUsefulFirst(proficiencies).find(
    entry => entry.normalizedName !== protectedNormalizedName
  );
  if (!entryToRemove) {
    return null;
  }

  em.remove(entryToRemove);
  await em.flush();
  return entryToRemove;
}

async function ensureAtLeastOneProficiencyExists(orm: MikroORM): Promise<void> {
  const em = orm.em.fork();
  const existingProficiencies = await em.find(ProficienciesEntry, {});
  if (existingProficiencies.length > 0) {
    return;
  }

  const now = new Date();
  const entry = em.create(ProficienciesEntry, {
    name: DEFAULT_PROFICIENCY.name,
    normalizedName: normalizeProficiencyName(DEFAULT_PROFICIENCY.name),
    recallWhen: DEFAULT_PROFICIENCY.recallWhen,
    contents: DEFAULT_PROFICIENCY.contents,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  });

  em.persist(entry);
  await em.flush();
}

const proficienciesPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'proficiencies',
    name: 'Proficiencies Plugin',
    brandColor: '#4abd12',
    description:
      'Proficiencies are skills the assistant can create and maintain for itself. ' +
      'They are primarily a way for the assistant to maintain organized banks of knowledge ' +
      'about specific, important, frequently referenced topics or tasks. Includes built in ' +
      'limits for the total number of proficiencies the assistant may have, and manages LFU ' +
      'removal of old proficiencies when the limit is exceeded.',
    version: 'LATEST',
    dependencies: [
      { id: 'memory', version: 'LATEST' },
      { id: 'skills', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config<ProficienciesPluginConfigSchema>(
      ProficienciesPluginConfigSchema,
      {
        maxProficiencies: 30,
      }
    );

    const memoryApi = plugin.request('memory');
    if (!memoryApi) {
      throw new Error(
        'Proficiencies plugin could not access the memory plugin API. Disable proficiencies or memory to recover, or fix the plugin dependency wiring.'
      );
    }

    const skillsApi = plugin.request('skills');
    if (!skillsApi) {
      throw new Error(
        'Proficiencies plugin could not access the skills plugin API. Disable proficiencies or enable skills to recover.'
      );
    }

    memoryApi.registerDatabaseModels([ProficienciesEntry]);
    skillsApi.registerSkillFile(
      path.join(import.meta.dirname, 'skills', 'Proficiencies.md')
    );

    const withDatabase = async <T>(callback: (orm: MikroORM) => Promise<T>) => {
      return memoryApi.onDatabaseReady(callback);
    };

    void withDatabase(async orm => {
      await ensureAtLeastOneProficiencyExists(orm);
    }).catch(seedError => {
      plugin.logger.error(
        'Proficiencies plugin: failed to seed default proficiency:',
        seedError
      );
    });

    plugin.registerTool({
      name: 'recallProficiency',
      availableFor: ['chat', 'voice', 'autonomy'],
      description:
        'Recall one of your stored proficiencies by name so you can apply it to the current task.',
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      parameters: RecallProficiencyParametersSchema,
      execute: async (args: RecallProficiencyParameters) => {
        const proficiencyName = validateProficiencyName(args.proficiencyName);
        if (!proficiencyName) {
          return 'Provide a non-empty proficiency name when calling recallProficiency.';
        }

        return withDatabase(async orm => {
          const em = orm.em.fork();
          const entry = await em.findOne(ProficienciesEntry, {
            normalizedName: normalizeProficiencyName(proficiencyName),
          });

          if (!entry) {
            return `No proficiency named ${proficiencyName} was found.`;
          }

          entry.usageCount += 1;
          entry.lastAccessedAt = new Date();
          await em.flush();

          return formatProficiency(entry);
        });
      },
    });

    plugin.registerTool({
      name: 'createProficiency',
      availableFor: ['chat', 'voice', 'autonomy'],
      description:
        'Create a new proficiency with a name, recall trigger, and reusable ' +
        'contents whenever you want to start a place to keep knowledge you ' +
        'accumulate over time about a specific task or topic. Recall your ' +
        '"Proficiencies" skill for details on how to manage your proficiencies.',
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      parameters: CreateProficiencyParametersSchema,
      execute: async (args: CreateProficiencyParameters) => {
        const proficiencyName = validateProficiencyName(args.proficiencyName);
        const recallWhen = validateRecallWhen(args.recallWhen);

        if (!proficiencyName) {
          return 'Provide a non-empty proficiency name when calling createProficiency.';
        }

        if (!recallWhen) {
          return 'Provide a non-empty recall trigger when calling createProficiency.';
        }

        return withDatabase(async orm => {
          const em = orm.em.fork();
          const normalizedName = normalizeProficiencyName(proficiencyName);
          const existing = await em.findOne(ProficienciesEntry, {
            normalizedName,
          });
          if (existing) {
            return `A proficiency named ${existing.name} already exists. Use updateProficiency to change it.`;
          }

          const now = new Date();
          const entry = em.create(ProficienciesEntry, {
            name: proficiencyName,
            normalizedName,
            recallWhen,
            contents: args.contents,
            usageCount: 0,
            createdAt: now,
            updatedAt: now,
            lastAccessedAt: now,
          });

          em.persist(entry);
          await em.flush();

          const removedEntry = await enforceProficiencyLimit(
            orm,
            config.getPluginConfig().maxProficiencies,
            normalizedName
          );
          if (removedEntry) {
            return `Created ${proficiencyName}. Removed proficiency ${removedEntry.name} to stay within the configured limit of ${config.getPluginConfig().maxProficiencies}.`;
          }

          return `Created proficiency ${proficiencyName}. Recall it when ${recallWhen}.`;
        });
      },
    });

    plugin.registerTool({
      name: 'updateProficiency',
      availableFor: ['chat', 'voice', 'autonomy'],
      description:
        'Update the recall trigger and or contents of an existing proficiency.',
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      parameters: UpdateProficiencyParametersSchema,
      execute: async (args: UpdateProficiencyParameters) => {
        const proficiencyName = validateProficiencyName(args.proficiencyName);
        if (!proficiencyName) {
          return 'Provide a non-empty proficiency name when calling updateProficiency.';
        }

        if (args.recallWhen === undefined && args.contents === undefined) {
          return 'Provide recallWhen, contents, or both when calling updateProficiency.';
        }

        return withDatabase(async orm => {
          const em = orm.em.fork();
          const entry = await em.findOne(ProficienciesEntry, {
            normalizedName: normalizeProficiencyName(proficiencyName),
          });

          if (!entry) {
            return `No proficiency named ${proficiencyName} was found.`;
          }

          if (args.recallWhen !== undefined) {
            const recallWhen = validateRecallWhen(args.recallWhen);
            if (!recallWhen) {
              return 'Provide a non-empty recall trigger when updating a proficiency.';
            }
            entry.recallWhen = recallWhen;
          }

          if (args.contents !== undefined) {
            const format = args.format ?? 'full';
            const resolved = resolveContents(
              entry.contents,
              format,
              args.contents
            );
            if (resolved.ok === false) {
              return (
                `ERROR: ${resolved.message} ` +
                `THE UPDATE WAS REJECTED.\nRe-recall the proficiency with recallProficiency to get the current content, then produce a valid unified diff patch. Use format=full only as a last resort if you cannot produce a valid diff after re-recalling.`
              );
            }
            entry.contents = resolved.contents;
          }

          const now = new Date();
          entry.updatedAt = now;
          entry.lastAccessedAt = now;
          await em.flush();

          return `Updated proficiency ${entry.name}.`;
        });
      },
    });

    plugin.registerHeaderSystemPrompt({
      name: 'proficiencies',
      weight: 60,
      getPrompt: async context => {
        if (context.conversationType === 'startup') {
          return false;
        }

        if (
          !context ||
          !context.availableTools?.length ||
          !context.availableTools?.includes('recallProficiency')
        ) {
          return false;
        }

        return withDatabase(async orm => {
          await ensureAtLeastOneProficiencyExists(orm);
          const em = orm.em.fork();
          const proficiencies = await em.find(
            ProficienciesEntry,
            {},
            {
              orderBy: { name: 'ASC' },
            }
          );

          if (proficiencies.length === 0) {
            return false;
          }

          return [
            `# Proficiencies\n`,
            `Proficiencies are skills you have created for yourself to help you with specific ` +
              `tasks or topics. Create and update them at your discretion after recalling the ` +
              `"Proficiencies" skill for details on how to manage them. Recall appropriate proficiencies ` +
              `proactively whenever you judge them relevant to the current task or topic.\n`,
            'You have the following proficiencies available for recall:\n',
            ...proficiencies.map(
              entry =>
                `- **${entry.name}:** recall ${entry.name} when ${entry.recallWhen}`
            ),
          ].join('\n');
        });
      },
    });

    plugin.registerFooterSystemPrompt({
      name: 'proficiencies',
      weight: 11000,
      getPrompt: async context => {
        if (context.conversationType === 'startup') {
          return false;
        }

        if (
          !context ||
          !context.availableTools?.length ||
          (!context.availableTools?.includes('recallProficiency') &&
            !context.availableTools?.includes('updateProficiency'))
        ) {
          return false;
        }

        return (
          `Don't forget to update any applicable proficiencies if you've just discovered ` +
          `any new information relevant to them.`
        );
      },
    });
  },
};

export default proficienciesPlugin;
