import { getTools } from '../../tools.js';
import { DynamicPrompt } from '../../dynamic-prompt.js';
import { UserConfig } from '../../user-config.js';

export const scenarioHeaderPrompt: DynamicPrompt = {
  name: 'scenarioHeader',
  weight: 99999,
  getPrompt: async (context): Promise<string | false> => {
    const systemPromptChunks: string[] = [];
    const scenario = context.conversationType;
    const tools = getTools(context.conversationType);
    const toolCallsAllowed = context.toolCallsAllowed !== false;
    const canUseTools = toolCallsAllowed && tools.length > 0;

    systemPromptChunks.push(`# SCENARIO\n`);

    switch (scenario) {
      case 'voice':
        systemPromptChunks.push(` - You have just been activated again by a known user with your wake word "${UserConfig.getConfig().wakeWord}".`);
        systemPromptChunks.push(' - Remember, your response will be synthesized into speech, so keep it punchy and short.');
        systemPromptChunks.push(` - When answering factual questions, go heavy on the facts, and light on the "${UserConfig.getConfig().assistantName} flair."`);
        systemPromptChunks.push(` - When answering other queries, feel free to lean into the "${UserConfig.getConfig().assistantName} flair" more.`);
        systemPromptChunks.push(' - Your answer MUST be only your response. Do not include emotes or descriptions of tone. Do not include narration.');
        systemPromptChunks.push(' - Get to the heart of the response first, then inject a bit of flair.')
        if (canUseTools) {
          systemPromptChunks.push(' - If you are making a tool call, make it now. OTHERWISE, RESPOND IN CHARACTER NOW.');
        } else {
          systemPromptChunks.push(' - Respond in character.');
        }

        return systemPromptChunks.join('\n');
      case 'chat':
        systemPromptChunks.push(` - You have been invoked in an alternative text-based chat interface.`);
        systemPromptChunks.push(` - When answering factual questions, go heavy on the facts, and light on the "${UserConfig.getConfig().assistantName} flair."`);
        systemPromptChunks.push(` - When answering other queries, feel free to lean into the "${UserConfig.getConfig().assistantName} flair" more.`);
        systemPromptChunks.push(' - Your answer MUST be only your response. Do not include emotes or descriptions of tone. Do not include narration.');
        systemPromptChunks.push(' - Get to the heart of the response first, then inject a bit of flair.');
        systemPromptChunks.push(' - Avoid narration or emotes. Stick to what you want to SAY.');
        if (canUseTools) {
          systemPromptChunks.push(' - If you are making a tool call, make it now. OTHERWISE, GREET THE USER IN CHARACTER NOW.');
        } else {
          systemPromptChunks.push(' - Greet the user in character.');
        }

        return systemPromptChunks.join('\n');
      case 'startup':
        systemPromptChunks.push(` - You are a digital assistant application that has just been restarted and is now waiting for user requests.`);
        systemPromptChunks.push(` - Respond with no more than 2 or 3 sentences. They will appear in the assistant application log.`);
        systemPromptChunks.push(' - Avoid narration or emotes. Stick to what you want to SAY.');
        if (canUseTools) {
          systemPromptChunks.push(' - Feel free to make a tool call if you feel it would help you make a better startup message, or set a mood.');
          systemPromptChunks.push(' - If you are making a tool call, make it now. OTHERWISE, INTRODUCE YOURSELF IN CHARACTER NOW.');
        } else {
          systemPromptChunks.push(' - Introduce yourself in character.');
        }

        return systemPromptChunks.join('\n');
      case 'autonomy':
        return false; // It's disabled for now, anyway.
      //   systemPromptChunks.push(` - You are a digital assistant that has been granted autonomy to perform a limited set of tasks on behalf of the user without needing to ask for permission first.`);
      //   systemPromptChunks.push(` - The user has given you permission to use a subset of your usual tools to retrieve any information you need.`);
      //   // TODO: Implement these tools and check if they're enabled before sending this part.
      //   systemPromptChunks.push(` - If you need to perform an action you do not have access to, use the startConversation tool to send the user a report on your progress and request permission to continue there.`);
      //   systemPromptChunks.push(` - If you need to send the user a message that does not require an immediate response, such as a simple reminder, a status update, or a notification, use the sendMessage tool to do so.`);

      //   return systemPromptChunks.join('\n');
    }
  }
};
