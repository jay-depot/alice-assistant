import { Tool } from '../lib/tool-system';

const recallMemoryTool: Tool = {
  name: 'recallMemory',
  description: 'Recalls a specific memory from the assistant\'s long-term memory. Use this tool when you want to retrieve information that the assistant has previously stored in its long-term memory.',
  systemPromptFragment: `Call recallMemory when you want to retrieve a specific memory from your long-term memory. The call takes one parameter, which is either a keyword, or a date, if the parameter is a keyword, you should recall up to 10 recent memories that are associated with that keyword. If the parameter is a date, you should recall all of the memories from that date. The parameter will be provided in the format "keyword:someKeyword" or "date:YYYY-MM-DD".`,
  callSignature: 'recallMemory(keywordOrId: string)',
  toolResultPromptIntro: `You have just received the results of a call to the recallMemory tool. The results are in JSON format and have the following structure:\n{\n  "memories": [\n    {\n      "memoryId": number,\n      "timestamp": string,\n      "content": string\n    },\n    ...\n  ]\n}\nThe "memories" field is an array of memory objects. Each memory object has a "memoryId" field, which is a unique identifier for that memory, a "timestamp" field, which is a string representing the date and time when that memory was stored, and a "content" field, which is a string containing the content of that memory. Use this information to answer the user's query, and remember that your response will be synthesized into speech, so keep it punchy and short.`,
  toolResultPromptOutro: `If you would need to make another tool call, output ONLY the call signature. Otherwise, answer the user's query in character.`,
  execute: async (args: Record<string, string>) => {
    // Here you would add the code to perform the actual memory recall based on the provided keyword or memoryId.
    // For the sake of this example, let's just return some dummy data.
    // TODO: The plan here is to use sqlite for this long-term memory, and to have a separate table for keywords that links to the memories, so that we can easily retrieve memories based on keywords or dates. MikroORM again?
    const dummyData = {
      memories: [
        {
          memoryId: 1,
          timestamp: '2024-01-01T12:00:00Z',
          content: ' - User initiatid an assistant session using the wake word and a query about good pizza options nearby'
        },
        {
          memoryId: 2,
          timestamp: '2024-01-02T15:30:00Z',
          content: 'Remembered that the user has a meeting every Monday at 10 AM.'
        }
      ]
    };
    return JSON.stringify(dummyData);
  }
};

export default recallMemoryTool;
