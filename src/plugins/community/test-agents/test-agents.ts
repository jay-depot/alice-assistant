import type { AlicePlugin } from '../../../lib.js';
import { TaskAssistants } from '../../../lib.js';
import { Type } from 'typebox';

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'test-agents': Record<string, never>;
  }
}

const TASK_SCENARIO_PROMPT =
  'You are a no-op task assistant used only for plumbing tests. ' +
  'Do not ask questions and do not perform any other actions.';

const AGENT_SCENARIO_PROMPT =
  'You are a no-op session-linked agent used only for plumbing tests. ' +
  'Immediately call agentReturnResult with a brief success summary and report.';

const testAgentsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'test-agents',
    name: 'Test Agents',
    version: 'LATEST',
    builtInCategory: 'community',
    description:
      'Registers a no-op task assistant and a no-op session-linked agent for ' +
      'agent framework smoke testing.',
    dependencies: [{ id: 'agents', version: 'LATEST' }],
  },

  registerPlugin: async api => {
    const plugin = await api.registerPlugin();

    plugin.registerConversationType({
      id: 'test-task-assistant',
      name: 'Test Task Assistant Session',
      description:
        'A minimal task-assistant conversation type that completes immediately.',
      baseType: 'autonomy',
      includePersonality: false,
      scenarioPrompt: TASK_SCENARIO_PROMPT,
    });

    plugin.registerTaskAssistant({
      id: 'test-task-assistant',
      name: 'Test Task Assistant',
      conversationType: 'test-task-assistant',
    });

    plugin.registerTool({
      name: 'startTestTaskAssistant',
      availableFor: ['chat'],
      description:
        'Call startTestTaskAssistant when the user indicates they want to test task assistant dispatch.',
      parameters: Type.Object({}),
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (_args, context) => {
        if (!context.sessionId) {
          throw new Error(
            'startTestTaskAssistant requires an active chat session.'
          );
        }

        const summary = 'No-op task assistant completed successfully.';

        await TaskAssistants.startForToolCall({
          definitionId: 'test-task-assistant',
          context,
          contextHints: 'No-op test task assistant run.',
          kickoffMessage:
            'This no-op task assistant is finalized immediately for plumbing tests.',
        });

        await TaskAssistants.complete(context.sessionId, {
          taskAssistantId: 'test-task-assistant',
          taskAssistantName: 'Test Task Assistant',
          conversationType: 'test-task-assistant',
          status: 'completed',
          summary,
          handbackMessage: summary,
          outputText: summary,
        });

        return summary;
      },
    });

    plugin.registerConversationType({
      id: 'test-session-linked-agent',
      name: 'Test Session-Linked Agent Session',
      description:
        'A minimal session-linked agent conversation type that returns immediately.',
      baseType: 'autonomy',
      includePersonality: false,
      scenarioPrompt: AGENT_SCENARIO_PROMPT,
    });

    plugin.addToolToConversationType(
      'test-session-linked-agent',
      'agents',
      'agentReturnResult'
    );

    const { autoStartTool } = plugin.registerSessionLinkedAgent({
      id: 'test-session-linked-agent',
      name: 'Test Session-Linked Agent',
      conversationType: 'test-session-linked-agent',
      maxIterations: 1,
      continuationPrompt:
        'Immediately call agentReturnResult with a success summary and report.',
      forceReturnPrompt:
        'Call agentReturnResult now with a success summary and report.',
      startToolName: 'startTestSessionLinkedAgent',
      startToolAvailableFor: ['chat'],
      startToolDescription:
        'Start a no-op session-linked agent that returns success immediately. Call when the user indicates they want to test session-linked agent dispatch.',
      startToolParameters: Type.Object({}),
      startToolSystemPromptFragment: '',
      startToolResultPromptOutro: '',
      buildStartup: async () => ({
        agentContextPrompt:
          'This is a no-op session-linked agent run. Return success immediately.',
        kickoffUserMessage:
          'Please call agentReturnResult immediately with a successful summary and a short report.',
      }),
      buildResult: async rawResult => ({
        handbackMessage:
          'No-op session-linked agent completed successfully: ' +
          rawResult.summary,
        outputText: rawResult.report,
      }),
    });

    plugin.registerTool(autoStartTool);
  },
};

export default testAgentsPlugin;
