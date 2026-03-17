import { Tool } from '../lib/tool-system';
import { UserConfig } from '../lib/user-config';

const systemHealthCheckTool: Tool = {
  name: 'systemHealthCheck',
  description: 'Performs a health check on the system and returns a report.',
  systemPromptFragment: `Call systemHealthCheck ONLY for questions about the status of the computer you are running on. This includes general questions about how you are doing, as you are the computer. systemHealthCheck takes no parameters.`,
  callSignature: 'systemHealthCheck',
  toolResultPromptIntro: `You have just received the results of a call to the systemHealthCheck tool. The results are in JSON format and have the following structure:\n{\n  "cpuUsage": number,\n  "memoryUsage": number,\n  "diskSpace": number,\n  "networkConnectivity": string\n}\nThe "cpuUsage" field is a number representing the current CPU usage as a percentage. The "memoryUsage" field is a number representing the current memory usage as a percentage. The "diskSpace" field is a number representing the current available disk space in gigabytes. The "networkConnectivity" field is a string describing the current network connectivity status (e.g., "connected", "disconnected", "limited"). Use this information to answer the user's query, and remember that your response will be synthesized into speech, so keep it punchy and short.`,
  toolResultPromptOutro: () => {
    if (UserConfig.getConfig().tools.systemHealthCheck.mustMentionIfNetworkDown) {
      return `If the network connectivity status is "disconnected" or "limited," you MUST include it in your response. If you would need to make another tool call, output ONLY the call signature. Otherwise, answer the user's query in character`;
    }
    return `If you would need to make another tool call, output ONLY the call signature. Otherwise, answer the user's query in character`;
  },
  execute: async (args: Record<string, string>) => {
    // Here you would add the code to perform the actual system health check and retrieve the relevant information.
    // For the sake of this example, let's just return some dummy data.
    const dummyData = {
      cpuUsage: 45,
      memoryUsage: 70,
      diskSpace: 120,
      networkConnectivity: 'connected'
    };
    return JSON.stringify(dummyData);
  }
};

export default systemHealthCheckTool;