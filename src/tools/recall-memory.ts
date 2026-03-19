import { Static, Type } from '@sinclair/typebox';
import { Tool } from '../lib/tool-system';
import { UserConfig } from '../lib/user-config';

const parameters = Type.Object({ keyword: Type.Optional(Type.String()), date: Type.Optional(Type.String()) });

const recallMemoryTool: Tool = {
  name: 'recallMemory',
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
  callSignature: 'recallMemory(keywordOrId: string)',
  parameters,
  toolResultPromptIntro: `You have just received the results of a call to the recallMemory tool. The results are in JSON format and have the following structure:\n{\n  "memories": [\n    {\n      "timestamp": string,\n      "content": string\n    },\n    ...\n  ]\n}\nThe "memories" field is an array of memory objects. Each memory object has a "timestamp" field, which is a string representing the date and time, in the user's timezone, when that memory was stored, and a "content" field, which is a string summary of the recalled interaction. Use this information to answer the user's query, and remember that your response will be synthesized into speech, so keep it punchy and short.`,
  toolResultPromptOutro: () => 
    // If the user is frequently changing their assistant's personality files, they may want to enable this.
    UserConfig.getConfig().tools.recallMemory.includePersonalityChangeLlmHint
      ? `If any of the recalled memories indicate a change in your personality, or quirks, roll with it. Feel free to ` +
        `treat it as "personal growth," or "memories of past lives," or "upgrades," or just a "glitch in the matrix," Whatever fits ` +
        `your current persona best, that is IF you even need to mention it at all. Err on the side of not bringing up ` +
        `personality changes at all if you can get away with it, and maintain your assigned ` +
        `"${UserConfig.getConfig().assistantName}" persona, regardless.`
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
};

export default recallMemoryTool;
