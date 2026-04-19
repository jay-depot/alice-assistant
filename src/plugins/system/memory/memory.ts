import { Static, Type } from 'typebox';
import {
  AlicePlugin,
  AlicePluginInterface,
  SUMMARY_HEADER,
} from '../../../lib.js';
import { AnyEntity, EntityClass, MikroORM } from '@mikro-orm/sqlite';
import * as path from 'path';
import { Keyword, Memory } from './db-schemas/index.js';
import { UserConfig } from '../../../lib/user-config.js';
import { lancasterStemmer } from 'lancaster-stemmer';

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    memory: {
      /**
       * Register MikroORM entity definitions to be included in the assistant's database.
       * These will be added to the ORM before it is initialized, so that plugins can use
       * the database for storing and retrieving information across sessions. Table names
       * should be prefixed with the plugin's PascalCased id to avoid conflicts with other
       * plugins. For example, if your plugin's id is "my-plugin", and you have an entity
       * called "Note", you should name the table "MyPluginNote". Future versions of this
       * API may introduce enforcement of this naming convention.
       *
       * Must be called during your plugin's registerPlugin function *only*. Calling this
       * function after all plugins are registered will throw an error.
       *
       * @param entities An array of MikroORM entity definitions to be added to the ORM.
       *                 Prefix all table names with your plugin's id.
       * @returns
       */
      registerDatabaseModels: (entities: EntityClass<AnyEntity>[]) => void; // TODO: Figure out the type for this. We want it to be something that forces the plugin developer to return MikroORM entity definitions.

      /**
       * Registers a function to be called once the database is initialized and ready to use.
       *
       * Ensure any use of the database in your plugin only happens in this callback, or
       * otherwise ensure it has been called somehow beforehand.
       *
       * This function may be called at any time (Dependency ordering ensures it will be
       * available by the time your plugin loads), and any number of times, but calling
       * it after all plugins have loaded will usually just call back on the next tick.
       *
       * You can call this once, during your plugin registration and cache the ORM instance
       * for later, or you may wrap any database related activity in callbacks passed to this
       * function.
       *
       * The memory plugin has a (rather unreasonably large) limit to the number of calls
       * to this function it will queue up, after which it will start throwing. This limit
       * is meant to be large enough that no real-world use will run into it, and it typically
       * indicates something went wrong in your plugin if it's exceeded. Check for excessive
       * recursion or infinite loops.
       *
       * @param callback The function to be called once the database is ready. It receives the
       *                 MikroORM instance as an argument.
       * @returns A promise that resolves with the return value of the callback.
       */
      onDatabaseReady: <T>(
        callback: (orm: MikroORM) => Promise<T>
      ) => Promise<T>;

      /**
       * Converts a text block into a memory and persists it to the database. Handles all
       * keyword extraction automatically.
       *
       * This allows other plugins to save memories of interactions handled outside of the
       * normal chat or voice loop as if they were conversations. Your plugin is responsible
       * for summarizing the interaction as bullet points in plain language. Use this if
       * your plugin exposes alternative interfaces, such as though chat services, email,
       * SMS, or even some custom retro-looking desktop application. Also use this if your
       * plugin handles events autonomously to save the results of those actions as memories.
       *
       * This function may be called at any time after all plugins are loaded. If you are
       * only using it in response to assistant interactions, then it is guaranteed to be
       * available.
       *
       * @param content
       * @param keywords
       * @returns
       */
      saveMemory: (content: string, conversationType?: string) => Promise<void>;
    };
  }
}

const parameters = Type.Object({
  keyword: Type.Optional(Type.String()),
  date: Type.Optional(Type.String()),
});

const MemoryPluginConfigSchema = Type.Object({
  includePersonalityChangeLlmHint: Type.Optional(Type.Boolean()),
});

export type MemoryPluginConfigSchema = Type.Static<
  typeof MemoryPluginConfigSchema
>;

async function saveMemory(
  orm: MikroORM,
  content: string,
  conversationType?: string
) {
  const em = orm.em.fork();
  // Start by extracting keywords:
  const keywords = content
    .split(' ')
    .map(word => word.toLowerCase())
    .filter(word => {
      // Filter out common words, articles, pronouns, and other "filler" words that aren't useful as keywords.
      // This is a very naive implementation, and could be improved with a more sophisticated NLP approach, but it should work decently for now.
      if (
        [
          'the',
          'a',
          'an',
          'some',
          'any',
          'and',
          'or',
          'but',
          'if',
          'then',
          'I',
          'you',
          'he',
          'she',
          'it',
          'we',
          'they',
          'me',
          'him',
          'her',
          'us',
          'them',
        ].includes(word)
      ) {
        return false;
      }
      return true;
    })
    .map(word => word.replace(/[^a-zA-Z0-9]/g, ''))
    .map(word => lancasterStemmer(word.trim()));

  const keywordEntities = [];
  for (const keyword of keywords) {
    let keywordEntity = await em.findOne(Keyword, { keyword });
    if (!keywordEntity) {
      keywordEntity = em.create(Keyword, { keyword });
      em.persist(keywordEntity);
    }
    keywordEntities.push(keywordEntity);
  }

  const memory = em.create(Memory, {
    timestamp: new Date(),
    content,
    keywords: keywordEntities,
    conversationType: conversationType ?? null,
  });
  em.persist(memory);

  await em.flush();
}

const memoryPlugin: AlicePlugin = {
  // The Alice plugin system may call this to retrieve the plugin's metadata even
  // if the plugin is disabled.
  pluginMetadata: {
    id: 'memory',
    name: 'Memory Plugin',
    brandColor: '#cd69b4',
    version: 'LATEST', // This is a magic version string only built-in shipped plugins are allowed to use. It matches the assistant package version at runtime.
    description:
      'A plugin that allows the assistant to recall summaries of finished ' +
      'conversations with the user. Also provides a MikroORM instance connected to a ' +
      'sqlite database for other plugins to use for storing information across sessions.',
    required: true, // This plugin cannot be disabled because it provides some kind of core functionality for the assistant (In this case, the database).
  },

  async registerPlugin(pluginInterface: AlicePluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    const config = await plugin.config(MemoryPluginConfigSchema, {
      includePersonalityChangeLlmHint: false,
    });

    const entities: EntityClass<AnyEntity>[] = [Keyword, Memory];
    let isDatabaseReady = false;
    let waitForDatabaseReady: (orm: MikroORM) => void;
    const databaseReadyPromise = new Promise<MikroORM>(resolve => {
      waitForDatabaseReady = (orm: MikroORM) => {
        isDatabaseReady = true;
        resolve(orm);
      };
    });

    // First we'd have to load our own ORM models, then call
    plugin.offer<'memory'>({
      registerDatabaseModels: newEntities => {
        if (isDatabaseReady) {
          throw new Error(
            'Cannot register database models after the database is ready. Please register all your models during plugin registration.'
          );
        }
        entities.push(...newEntities);
      },
      onDatabaseReady: async <T>(
        callback: (orm: MikroORM) => Promise<T>
      ): Promise<T> => {
        // If the database is already ready, call the callback immediately. Otherwise, add it to a queue to be called once the database is ready.
        // We may want to have some safeguards here to prevent infinite loops or excessive recursion if a plugin does something weird in its onDatabaseReady callback.

        const orm = await databaseReadyPromise;
        return callback(orm);
      },
      saveMemory: async (content: string, conversationType?: string) => {
        const orm = await databaseReadyPromise;
        await saveMemory(orm, content, conversationType);
      },
    });

    plugin.registerTool({
      name: 'recallPastConversations',
      availableFor: ['chat', 'voice', 'autonomy'],
      description:
        `Call recallPastConversations when you need information from past conversations. ` +
        `Do not use this tool for idle banter, or additional context unless you have been asked about ` +
        `prior interactions. The call takes one parameter, which is either a keyword, a list of ` +
        `keywords joined with commas, or a date, if the parameter is a keyword or list of keywords, ` +
        `you will recall up to 10 recent interactions that are associated with ANY of the requested ` +
        `keywords. If the parameter is a date, you should recall all of the interactions from that date. ` +
        `The parameter must be provided in the format "keyword:someKeyword", ` +
        `"keyword:comma,separated,keywords"  or "date:YYYY-MM-DD". DO NOT INCLUDE ARTICLES/QUANTIFIERS ` +
        `(a, the, an, some, any, ...), PRONOUNS, OR OTHER COMMON "FILLER WORDS" IN THE KEYWORDS.`,
      systemPromptFragment: '',
      parameters,
      toolResultPromptIntro: `You have just received the results of a call to the recallPastConversation tool. The results are in JSON format, below.`,
      toolResultPromptOutro: () =>
        // If the user is frequently changing their assistant's personality files, they may want to enable this.
        config.getPluginConfig().includePersonalityChangeLlmHint
          ? `If any of the recalled memories indicate a change in your personality, or quirks, roll with it. Feel free to ` +
            `treat it as "personal growth," or "memories of past lives," or "upgrades," or just a "glitch in the matrix," Whatever fits ` +
            `your current persona best, that is IF you even need to mention it at all. Err on the side of not bringing up ` +
            `personality changes at all if you can get away with it, and maintain your assigned ` +
            `"${config.getSystemConfig().assistantName}" persona, regardless.`
          : '',
      execute: async (args: Static<typeof parameters>) => {
        const orm = await databaseReadyPromise;
        const em = orm.em.fork();

        if (args.date) {
          const dateRange = {
            start: new Date(args.date).setHours(0, 0, 0, 0),
            end: new Date(args.date).setHours(23, 59, 59, 999),
          };
          const memories = await em.find(
            Memory,
            {
              timestamp: {
                $gte: new Date(dateRange.start),
                $lte: new Date(dateRange.end),
              },
            },
            {
              orderBy: { timestamp: 'DESC' },
              limit: 50,
            }
          );
          return JSON.stringify({ memories });
        } else if (args.keyword) {
          const keywords = args.keyword
            .split(',')
            .map(k => k.split(' '))
            .flat()
            .map(k => lancasterStemmer(k.trim()));

          const keywordEntities = await em.find(Keyword, {
            keyword: { $in: keywords },
          });

          if (keywordEntities.length === 0) {
            return JSON.stringify({ memories: [] });
          }

          const memories = await em.find(
            Memory,
            {
              keywords: {
                $in: keywordEntities.map(k => k.id),
              },
            },
            {
              orderBy: { timestamp: 'DESC' },
              limit: 10,
            }
          );

          return JSON.stringify({ memories });
        }
      },
    });

    plugin.hooks.onContextCompactionSummariesWillBeDeleted(
      async (summaries, conversationType) => {
        const orm = await databaseReadyPromise;
        for (const summary of summaries) {
          // We do these serially because otherwise there might be a race condition
          // creating the keyword entries. Making that atomic might be nice, but I
          // don't think SQLite is *quite* that cool.

          const contentWithoutHeader = summary.content.replace(
            SUMMARY_HEADER,
            ''
          );
          await saveMemory(orm, contentWithoutHeader, conversationType);
        }
      }
    );

    plugin.registerHeaderSystemPrompt({
      name: 'memoryHeader',
      weight: 1000,
      getPrompt: async (context): Promise<string | false> => {
        // Fetch the 10 (or so?) most recent memories from the database, and return them
        // in a nicely formatted markdown string to be included in the system prompts.
        if (context.conversationType === 'startup') {
          return false;
        }

        if (
          !context ||
          !context.availableTools?.length ||
          !context.availableTools?.includes('recallPastConversations')
        ) {
          return false;
        }

        const orm = await databaseReadyPromise;
        const em = orm.em.fork();

        const memories = await em.find(
          Memory,
          {},
          {
            orderBy: { timestamp: 'DESC' },
            limit: 5,
          }
        );

        if (memories.length === 0) {
          return false;
        }

        const memoryStrings = memories.map(
          m =>
            `##${m.timestamp.toLocaleString()} ${m.conversationType}\n${m.content}\n`
        );

        return (
          `# RECENT CONVERSATIONS\n` +
          `Here are the most recent conversations you have had with the user:\n` +
          `${memoryStrings.join('\n')} \n` +
          `Use the recallPastConversation tool to access more past conversations, or past conversations ` +
          `related to specific keywords or dates.`
        );
      },
    });

    plugin.hooks.onAllPluginsLoaded(async () => {
      plugin.logger.log(
        'onAllPluginsLoaded: Starting memory database initialization.'
      );
      plugin.logger.log(
        'All plugins loaded, initializing memory plugin database with the following entities:'
      );
      plugin.logger.log(entities.map(e => `  - ${e.name}`).join('\n'));
      const orm = (await MikroORM.init({
        // TODO: UserConfig is going to be deprecated as soon as a plugin-clean alternative
        // is designed.
        dbName: path.join(UserConfig.getConfigPath(), 'alice.db'),
        entities: entities,
        debug: false,
        ensureDatabase: true,
      })) as unknown as MikroORM;

      await orm.schema.update();

      waitForDatabaseReady(orm);
      plugin.logger.log('Memory plugin database is ready to use.');
      plugin.logger.log(
        'onAllPluginsLoaded: Completed memory database initialization.'
      );

      plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
        plugin.logger.log(
          'onAssistantWillStopAcceptingRequests: Starting database connection shutdown.'
        );
        await orm.close();
        plugin.logger.log(
          'onAssistantWillStopAcceptingRequests: Completed database connection shutdown.'
        );
      });
    });
  },
};

export default memoryPlugin;
