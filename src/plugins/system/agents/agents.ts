import type { AlicePlugin } from '../../../lib.js';
import { AgentSystem } from '../../../lib.js';
import { Type } from 'typebox';

const agentsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'agents',
    name: 'Agent Engine',
    version: 'LATEST',
    builtInCategory: 'system',
    description:
      'Provides the session-linked agent runtime and the framework tools ' +
      '(agentReportProgress, agentReturnResult) that all session-linked agents use.',
  },

  registerPlugin: async api => {
    const plugin = await api.registerPlugin();

    plugin.registerTool({
      name: 'agentReportProgress',
      availableFor: [],
      description:
        'Report a progress update from within a session-linked agent. ' +
        'Call this after each significant milestone in your assigned task.',
      parameters: Type.Object({
        message: Type.String({
          description:
            'A concise progress update describing what was found or accomplished. ' +
            'One to three sentences.',
        }),
      }),
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (args, context) => {
        const typedArgs = args as { message: string };
        if (!context.agentInstanceId) {
          return 'No active agent instance found. Progress not recorded.';
        }
        AgentSystem.reportProgress(context.agentInstanceId, typedArgs.message);
        return 'Progress update recorded.';
      },
    });

    plugin.registerTool({
      name: 'agentReturnResult',
      availableFor: [],
      description:
        'Return the final result from a session-linked agent. ' +
        'Call this when you have completed all of your assigned tasks. ' +
        'This ends the agent session.',
      parameters: Type.Object({
        summary: Type.String({
          description:
            'A one to two sentence summary of your assigned tasks and their outcomes.',
        }),
        report: Type.String({
          description:
            'The full report in markdown format. ' +
            'Include sections: Task Definitions, Task Execution, and Outcomes.',
        }),
      }),
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (args, context) => {
        const typedArgs = args as { summary: string; report: string };
        if (!context.agentInstanceId) {
          return 'No active agent instance found. Result not recorded.';
        }
        await AgentSystem.returnResult(context.agentInstanceId, {
          summary: typedArgs.summary,
          report: typedArgs.report,
        });
        return 'Result recorded. Agent session complete.';
      },
    });

    plugin.hooks.onUserConversationWillEnd(async conversation => {
      if (conversation.sessionId) {
        AgentSystem.cancelBySession(conversation.sessionId);
      }
    });
  },
};

export default agentsPlugin;
