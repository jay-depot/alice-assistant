import { Tool } from '../lib/tool-system'
import { UserConfig } from '../lib/user-config';

const getNewsHeadlines: Tool = {
  name: 'getNewsHeadlines',
  description: 'Retrieves the latest news headlines from a news API.',
  systemPromptFragment: `Call getNewsHeadlines ONLY for queries about news or current events. When building the query, strip conversational filler ('can you find me', 'I need', 'please'). Examples: 'What's going on in the world today?' → query: 'world', 'What's the latest from the Middle East?' → query: 'middle east', 'What's the local news? → query: [INSERT CURRENT LOCATION FROM CONTEXT ABOVE]`,
  callSignature: 'getNewsHeadlines',
  toolResultPromptIntro: `You have just received the results of a call to the getNewsHeadlines tool. The results are in JSON format and have the following structure:\n{\n  "headlines": [string]\n}\nThe "headlines" field is an array of strings, each string being a news headline. Use these headlines to answer the user's query, and remember that your response will be synthesized into speech, so keep it punchy and short. If the user asked for news in a specific category, make sure to mention that category in your response.`,
  toolResultPromptOutro: () => {
    const promptOutroParts: string[] = [];
    if (UserConfig.getConfig().tools.getNewsHeadlines.generallyTrustedSources.length > 0) {
      promptOutroParts.push(`The user generally trusts the following, or similar, news sources: ${UserConfig.getConfig().tools.getNewsHeadlines.generallyTrustedSources.join(', ')}.`);
    }
    if (UserConfig.getConfig().tools.getNewsHeadlines.marginallyTrustedSources.length > 0) {
      promptOutroParts.push(`The user is somewhat skeptical of the following, or similar, news sources: ${UserConfig.getConfig().tools.getNewsHeadlines.marginallyTrustedSources.join(', ')}.`);
    }
    if (UserConfig.getConfig().tools.getNewsHeadlines.untrustedSources.length > 0) {
      promptOutroParts.push(`The user does not trust the following, or similar, news sources: ${UserConfig.getConfig().tools.getNewsHeadlines.untrustedSources.join(', ')}.`);
    }
    return promptOutroParts.join(' ');
  },
  execute: async (args: Record<string, string>) => {
    const category = args.category;
    // Here you would add the code to call the news API and retrieve the headlines based on the category.
    // For the sake of this example, let's just return some dummy headlines.
    const dummyHeadlines: Record<string, string[]> = {
      technology: [
        "Tech Company A releases new product",
        "Tech Company B announces partnership with Tech Company C"
      ],
      sports: [
        "Team X wins championship",
        "Player Y breaks record"
      ],
      business: [
        "Company D reports record profits",
        "Company E faces lawsuit"
      ],
      general: [
        "Global event F impacts markets",
        "Study reveals new insights on topic G"
      ]
    };
    const headlines = category && dummyHeadlines[category] ? dummyHeadlines[category] : dummyHeadlines.general;
    return JSON.stringify({ headlines });
  }
};

export default getNewsHeadlines;
