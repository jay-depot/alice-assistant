import { Static, Type } from '@sinclair/typebox';
import { AlicePlugin, AlicePluginInterface } from '../../lib/alice-plugin-interface.js';
import { MikroORM } from '@mikro-orm/sqlite';

declare module '../../lib/alice-plugin-interface.js' {
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
      registerDatabaseModels: (entities: any[]) => void; // TODO: Figure out the type for this. We want it to be something that forces the plugin developer to return MikroORM entity definitions.

      /**
       * Registers a function to be called once the database is initialized and ready to use.
       * 
       * Ensure any use of the database in your plugin only does so *after* this callback 
       * is called, to avoid any issues with the database not being ready.
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
       * @param callback 
       * @returns 
       */
      onDatabaseReady: (callback: (orm: MikroORM) => void) => void;

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
      saveMemory: (content: string, keywords?: string[]) => Promise<void>;
    }
  }
};

const parameters = Type.Object({ keyword: Type.Optional(Type.String()), date: Type.Optional(Type.String()) });

const memoryPlugin: AlicePlugin = {
  // The Alice plugin system may call this to retrieve the plugin's metadata even 
  // if the plugin is disabled. Thus function should not rely on any external state, 
  // and should just return a plain object with the metadata.
  pluginMetadata: {
    id: 'memory',
    name: 'Memory Plugin',
    version: 'LATEST', // This is a magic version string only system plugins are allowed to use. It matches the assistant package version at runtime.
    description: 'A plugin that allows the assistant to recall summaries of finished ' +
      'conversations with the user. Also provides a MikroORM instance connected to a ' +
      'sqlite database for other plugins to use for storing information across sessions.',
    system: true, // only plugins listed in src/plugins/system-plugins.json are allowed to set this to true. The only thing it does is allow the plugin to be marked "required" as well.
    required: true, // This plugin cannot be disabled because it provides some kind of core functionality for the assistant (In this case, the database). 
  },

  async registerPlugin(pluginInterface: AlicePluginInterface) {
    const plugin = await pluginInterface.registerPlugin(memoryPlugin.pluginMetadata);

    const config = await plugin.config(Type.Object({
      includePersonalityChangeLlmHint: Type.Optional(Type.Boolean()),
    }));

    // First we'd have to load our own ORM models, then call
    plugin.offer<'memory'>({ 
      registerDatabaseModels: (entities) => {
        // Add these entity definitions to the array we'll pass into MikroORM when we initialize it. 
        // We may want to have some kind of validation here to make sure the entities are well-formed, 
        // and to provide helpful error messages if not.
      },
      onDatabaseReady: (callback: (orm: MikroORM) => void) => { 
        /* store the callback and call it with the orm instance once it's ready */ 
      },
      saveMemory: async (content: string, keywords?: string[]) => {
        // TBD: This is where we'd save a memory to the database, along with any associated keywords. 
      }
    });
    // then we'd go through the rest of the setup first. After all plugins are loaded, and any 
    // plugins that depend on us have had a chance to register their ORM models and their onDatabaseReady 
    // callbacks, we'd initialize the ORM instance, and call all the stored onDatabaseReady callbacks 
    // with the instance, so that any plugin that needs direct access to the assistant's sqlite database 
    // can have it. (And in theory, potentially use different database backends without the plugins giving 
    // a damn, but we'll see about that later.)
    // After that, any calls to registerDatabaseModels or onDatabaseReady should throw.

    plugin.registerTool({
        name: 'recallMemory',
        availableFor: ['chat-session', 'voice-session', 'autonomy'],
        description: 'Recalls a specific memory from the assistant\'s memory of previous interactions.',
        systemPromptFragment: `Call recallMemory when you need information from a past conversation. ` +
          `Do not use this tool for idle banter, or additional context unless you have been asked about ` +
          `prior interactions. The call takes one parameter, which is either a keyword, a list of ` +
          `keywords joined with commas, or a date, if the parameter is a keyword or list of keywords, ` +
          `you will recall up to 10 recent interactions that are associated with ALL of the requested ` +
          `keywords. If the parameter is a date, you should recall all of the interactions from that date. ` +
          `The parameter must be provided in the format "keyword:someKeyword", ` +
          `"keyword:comma,separated,keywords"  or "date:YYYY-MM-DD". DO NOT INCLUDE ARTICLES/QUANTIFIERS ` +
          `(a, the, an, some, any, ...), PRONOUNS, OR OTHER COMMON "FILLER WORDS" IN THE KEYWORDS.`,
        callSignature: 'recallMemory(["keyword"|"date"]: string)',
        parameters,
        toolResultPromptIntro: `You have just received the results of a call to the recallMemory tool. The results are in JSON format and have the following structure:\n{\n  "memories": [\n    {\n      "timestamp": string,\n      "content": string\n    },\n    ...\n  ]\n}\nThe "memories" field is an array of memory objects. Each memory object has a "timestamp" field, which is a string representing the date and time, in the user's timezone, when that memory was stored, and a "content" field, which is a string summary of the recalled interaction. Use this information to answer the user's query, and remember that your response will be synthesized into speech, so keep it punchy and short.`,
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
          // TODO: The plan here is to use sqlite for this long-term memory, and to have a separate table for keywords that links to the memories, so that we can easily retrieve memories based on keywords or dates. MikroORM again?
          // TODO: For that matter, where am I hooking in the storage code?
          const dummyData = {
            memories: [
              {
                timestamp: '2024-01-01T12:00:00 UTC-5',
                content: 
                  ' - User initiated an assistant session using the wake word and a query about good pizza options nearby\n' +
                  ' - Assistant called webSearch with the query "good pizza options nearby"\n' +
                  ' - Assistant responded to the user in character with a list of good pizza options nearby, including "Pizza Place A", ' +
                    '"Pizza Place B", and "Pizza Place C", and a remark about the user\'s "primitive biology" needing higher quality sustenance on occasion.\n' + 
                  ' - User thanked the assistant and ended the session.\n' + 
                  ' - Assistant signed off, in character, playfully calling the user "meat sack" and mocking their "primitive biological need to eat."'
              },
              {
                timestamp: '2024-01-02T15:30:00 UTC-5',
                content:
                  ' - User initiated an assistant session using the wake word and a query about the weather\n' +
                  ' - Assistant called weather with the query "current"\n' +
                  ' - Assistant responded to the user in character with the current weather conditions, including temperature, precipitation, and any relevant weather alerts.\n' +
                  ' - User asked a follow-up question about whether they should bring an umbrella\n' +
                  ' - Assistant responded in character with a recommendation based on the current weather conditions, advising the user to bring an umbrella if there is a high chance of rain. Assistant also made a joke about how the user is always asking about the weather, playfully suggesting a move to a place with better weather.\n' +
                  ' - User complimented the assistant\'s humor, and ended the session.\n' +
                  ' - Assistant signed off, in character, with a sardonic remark about the weather and the user\'s obsession with it.'
              },
              {
                timestamp: '2024-01-03T09:45:00 UTC-5',
                content: 
                  ' - User initiated an assistant session using the wake word and a a request for a joke\n' +
                  ' - Assistant responded in character with a knock-knock joke, including both the setup and the punchline.\n' +
                  ' - User came back with the reply "not bad, for hot sand."\n' +
                  ' - Assistant responded in character, becoming playfully passive-aggressive and sarcastically complimenting the user\'s comeback, while also making a quip about how the user is "not just a decaying husk, but a slightly amusing decaying husk."\n' +
                  ' - User laughed and ended the session.\n' +
                  ' - Assistant signed off, in character, with a witty remark about the user\'s sense of humor and their status as a "meat sack of some value, sometimes."'
              }
            ]
          };
          return JSON.stringify(dummyData);
        }
      }
    );

    plugin.hooks.onUserConversationWillEnd(async (conversation) => {});

    plugin.registerHeaderSystemPrompt({
      name: 'memoryHeader',
      weight: 1000,
      getPrompt: async (context): Promise<string | false> => {
        // Fetch the 10 (or so?) most recent memories from the database, and return them 
        // in a nicely formatted markdown string to be included in the system prompts.
        return false;
      }
    });
  }
}

export default memoryPlugin;
