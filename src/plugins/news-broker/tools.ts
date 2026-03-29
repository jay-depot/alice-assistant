import { Static, Type } from 'typebox';
import { Tool } from '../../lib/tool-system.js'
import { UserConfig } from '../../lib/user-config.js';

const parameters = Type.Object({ query: Type.String() });

const getNewsHeadlines: Tool = {
  name: 'getNewsHeadlines',
  availableFor: ['chat-session', 'voice-session', 'autonomy'],
  description: 'Retrieves the latest news headlines from a news API.',
  systemPromptFragment: `Call getNewsHeadlines ONLY for queries about news or current events, including local ` +
    `news, national news, and world news. getNewsHeadlines takes one mandatory parameter, which is named ` +
    `"query," and it is a string. When building the query, strip conversational filler ` +
    `('can you find me', 'I need', 'please'). Examples: 'What's going on in the world today?' → query: 'world', ` +
    `'What's the latest from the Middle East?' → query: 'middle east', ` +
    `'What's the local news? → query: [INSERT CURRENT LOCATION FROM CONTEXT ABOVE]`,
  callSignature: 'getNewsHeadlines',
  parameters,
  toolResultPromptIntro: 
    'You have just received the results of a call to the getNewsHeadlines tool. ' +
    'The results are in JSON format and have the following structure ' +
    '{\n' +
    '    "headlines": [\n' +
    '        {\n' +
    '            "headline": "Headline 1",\n' +
    '            "source": "Source A"\n' +
    '        },\n' +
    '        ...\n' +
    '    ]\n' +
    '}\n\n' +
    `The "headlines" field is an array of objects, each representing a news headline. Each object has a "headline" field, which is a string containing the headline text, and a "source" field, which is a string containing the name of the news source. Use this information to answer the user's query, and remember that your response will be synthesized into speech, so keep it punchy and short.`,
  toolResultPromptOutro: () => {
    const promptOutroParts: string[] = [];
    // if (UserConfig.getConfig().toolSettings.getNewsHeadlines.generallyTrustedSources.length > 0) {
    //   promptOutroParts.push(`The user generally trusts the following, or similar, news sources: ${UserConfig.getConfig().toolSettings.getNewsHeadlines.generallyTrustedSources.join(', ')}.`);
    // }
    // if (UserConfig.getConfig().toolSettings.getNewsHeadlines.marginallyTrustedSources.length > 0) {
    //   promptOutroParts.push(`The user is somewhat skeptical of the following, or similar, news sources: ${UserConfig.getConfig().toolSettings.getNewsHeadlines.marginallyTrustedSources.join(', ')}.`);
    // }
    // if (UserConfig.getConfig().toolSettings.getNewsHeadlines.untrustedSources.length > 0) {
    //   promptOutroParts.push(`The user does not trust the following, or similar, news sources: ${UserConfig.getConfig().toolSettings.getNewsHeadlines.untrustedSources.join(', ')}.`);
    // }
    return promptOutroParts.join(' ');
  },
  execute: async (args: Static<typeof parameters>) => {
    const category = args.query;
    // Here you would add the code to call the news API and retrieve the headlines based on the category.
    // For the sake of this example, let's just return some dummy headlines.
    const dummyHeadlines: Record<string, Record<string, string>[]> = {
      technology: [
        {
          headline: "Tech Company A releases new product",
          source: "Tech News Daily"
        },
        {
          headline: "Tech Company B announces partnership with Tech Company C",
          source: "Tech Insider"
        }
      ],
      sports: [
        {
          headline: "Team X wins championship",
          source: "Sports News Daily"
        },
        {
          headline: "Player Y breaks record",
          source: "Sports Insider"
        }
      ],
      business: [
        {
          headline: "Company D reports record profits",
          source: "Business News Daily"
        },
        {
          headline: "Company E faces lawsuit",
          source: "Business Insider"
        }
      ],
      general: [
        {
          headline: "Global event F impacts markets",
          source: "Global News Daily"
        },
        {
          headline: "Study reveals new insights on topic G",
          source: "Science News Daily"
        }
      ],
      politics: [
        {
          headline: "Politician H announces candidacy for office",
          source: "Political News Daily"
        },
        {
          headline: "Government passes new legislation on topic I",
          source: "Political Insider"
        }
      ],
      world: [
        {
          headline: "Country J experiences natural disaster",
          source: "World News Daily"
        },
        {
          headline: "International summit on topic K concludes with agreement",
          source: "World Insider"
        }
      ],
      local: [
        {
          headline: "Local event L draws large crowd",
          source: "Local News Daily"
        },
        {
          headline: "City M announces new policy on topic N",
          source: "Local Insider"
        }
      ]
    };

    const headlines = category && dummyHeadlines[category] ? dummyHeadlines[category] : dummyHeadlines.general;
    return JSON.stringify({ headlines });
  }
};

export default getNewsHeadlines;
