import { getTools } from '../../tools.js';
import { DynamicPrompt } from '../../dynamic-prompt.js';
import { UserConfig } from '../../user-config.js';
import { getConversationTypeDefinition } from '../../conversation-types.js';

function substituteScenarioTemplate(template: string): string {
  return template
    .replaceAll('{{assistantName}}', UserConfig.getConfig().assistantName)
    .replaceAll('{{wakeWord}}', UserConfig.getConfig().wakeWord);
}

function buildGenericScenarioPrompt(name: string, description: string): string {
  return [
    ` - You are operating in the conversation mode "${name}".`,
    ` - Mode description: ${description}`,
    ' - Respond in a way that fits this mode, keeping the user experience coherent and intentional.',
    ' - Avoid narration or emotes. Stick to what you want to SAY.',
  ].join('\n');
}

export const scenarioHeaderPrompt: DynamicPrompt = {
  name: 'scenarioHeader',
  weight: 99999,
  getPrompt: async (context): Promise<string | false> => {
    const systemPromptChunks: string[] = [];
    const scenario = context.conversationType;
    const tools = getTools(context.conversationType);
    const toolCallsAllowed = context.toolCallsAllowed !== false;
    const canUseTools = toolCallsAllowed && tools.length > 0;
    const conversationTypeDefinition = getConversationTypeDefinition(scenario);

    if (!conversationTypeDefinition) {
      return false;
    }

    systemPromptChunks.push(`# SCENARIO\n`);

    systemPromptChunks.push(
      substituteScenarioTemplate(
        conversationTypeDefinition.scenarioPrompt ??
          buildGenericScenarioPrompt(conversationTypeDefinition.name, conversationTypeDefinition.description),
      ),
    );

    switch (conversationTypeDefinition.baseType) {
      case 'voice':
        systemPromptChunks.push(
          canUseTools
            ? ' - If you are making a tool call, make it now. OTHERWISE, RESPOND IN CHARACTER NOW.'
            : ' - Respond in character.',
        );
        break;
      case 'chat':
        systemPromptChunks.push(
          canUseTools
            ? ' - If you are making a tool call, make it now. OTHERWISE, GREET THE USER IN CHARACTER NOW.'
            : ' - Greet the user in character.',
        );
        break;
      case 'startup':
        if (canUseTools) {
          systemPromptChunks.push(' - Feel free to make a tool call if you feel it would help you make a better startup message, or set a mood.');
          systemPromptChunks.push(' - If you are making a tool call, make it now. OTHERWISE, INTRODUCE YOURSELF IN CHARACTER NOW.');
        } else {
          systemPromptChunks.push(' - Introduce yourself in character.');
        }
        break;
      case 'autonomy':
        if (canUseTools) {
          systemPromptChunks.push(' - You are acting within a limited-autonomy workflow. Use only the tools available in this mode.');
          systemPromptChunks.push(' - If a tool call would help you complete the task safely, make it now. Otherwise, continue the workflow in character.');
        } else {
          systemPromptChunks.push(' - You are acting within a limited-autonomy workflow. Continue the task safely and concisely in character.');
        }
        break;
    }

    return systemPromptChunks.join('\n');
  }
};
