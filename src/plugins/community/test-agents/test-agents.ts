import path from 'node:path';
import type { AlicePlugin } from '../../../lib.js';
import { createTaskAssistantToolPair } from '../../../lib.js';
import { Type } from 'typebox';

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'test-agents': Record<string, never>;
  }
}

const TASK_SCENARIO_PROMPT =
  'You are an interactive test agent designed to verify that task assistant ' +
  'subconversations work end-to-end. Your job is simple:\n' +
  '1. Greet the user warmly and let them know you are the test task assistant.\n' +
  '2. Have a brief friendly exchange with them.\n' +
  '3. As soon as the user says anything that indicates they are done — such as ' +
  '"done", "finish", "end", "goodbye", "that\'s all", "complete", or similar — ' +
  'immediately call completeTestTaskAssistant. Do not ask for confirmation; just call it.';

const AGENT_SCENARIO_PROMPT =
  'You are a no-op session-linked agent used only for plumbing tests. ' +
  'Immediately call agentReturnResult with a brief success summary and report.';

const INDEPENDENT_AGENT_SCENARIO_PROMPT =
  'You are a no-op independent agent used only for plumbing tests. ' +
  'You should not perform any tool calls or side effects.';

const testAgentsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'test-agents',
    name: 'Test Agents',
    brandColor: '#ddbd7c',
    version: 'LATEST',
    builtInCategory: 'community',
    description:
      'Registers a no-op task assistant and a no-op session-linked agent for ' +
      'agent framework smoke testing.',
    dependencies: [
      { id: 'agents', version: 'LATEST' },
      { id: 'web-ui', version: 'LATEST' },
    ],
  },

  registerPlugin: async api => {
    const plugin = await api.registerPlugin();

    const webUI = plugin.request('web-ui');
    if (webUI) {
      webUI.registerStylesheet(path.join(import.meta.dirname, 'style.css'));
    }

    plugin.registerConversationType({
      id: 'test-task-assistant',
      name: 'Test Task Assistant Session',
      description:
        'An interactive task-assistant conversation type for end-to-end testing.',
      baseType: 'chat',
      includePersonality: false,
      scenarioPrompt: TASK_SCENARIO_PROMPT,
    });

    plugin.registerTaskAssistant({
      id: 'test-task-assistant',
      name: 'Test Task Assistant',
      conversationType: 'test-task-assistant',
    });

    const testTaskAssistantTools = createTaskAssistantToolPair({
      start: {
        definitionId: 'test-task-assistant',
        name: 'startTestTaskAssistant',
        availableFor: ['chat'],
        description:
          'Call startTestTaskAssistant when the user indicates they want to test task assistant dispatch. ' +
          'This launches an interactive sub-conversation to verify the task assistant workflow end-to-end.',
        parameters: Type.Object({}),
        systemPromptFragment: '',
        buildHandoff: async () => ({
          contextHints: 'Interactive end-to-end task assistant workflow test.',
          kickoffMessage:
            'Hello! I am the test task assistant. Feel free to say anything — when you are ready to ' +
            'finish, just say so and I will wrap up.',
        }),
      },
      complete: {
        name: 'completeTestTaskAssistant',
        description:
          'Call completeTestTaskAssistant when the user indicates the test conversation is over.',
        parameters: Type.Object({
          summary: Type.String({
            description: 'Brief summary of the test conversation.',
          }),
        }),
        systemPromptFragment: '',
        buildCompletion: async args => ({
          summary: String(args.summary),
          handbackMessage: `Test task assistant completed. Summary: ${String(args.summary)}`,
        }),
      },
    });

    plugin.registerTool(testTaskAssistantTools.startTool);
    plugin.addToolToConversationType(
      'test-task-assistant',
      'test-agents',
      testTaskAssistantTools.completionTool.name
    );
    plugin.registerTool(testTaskAssistantTools.completionTool);

    plugin.registerConversationType({
      id: 'test-session-linked-agent',
      name: 'Test Session-Linked Agent Session',
      description:
        'A minimal session-linked agent conversation type that returns immediately.',
      baseType: 'autonomy',
      includePersonality: false,
      scenarioPrompt: AGENT_SCENARIO_PROMPT,
    });

    plugin.registerConversationType({
      id: 'test-independent-agent',
      name: 'Test Independent Agent Session',
      description:
        'A minimal independent agent conversation type reserved for runtime smoke tests.',
      baseType: 'autonomy',
      includePersonality: false,
      scenarioPrompt: INDEPENDENT_AGENT_SCENARIO_PROMPT,
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

    const independentAgent = plugin.registerIndependentAgent({
      id: 'test-independent-agent',
      name: 'Test Independent Agent',
      description:
        'A nearly no-op independent agent that exists only to prove runtime plumbing.',
      conversationType: 'test-independent-agent',
      start: async control => {
        control.markRunning('Independent agent runtime is online.');
        control.markSleeping('No work queued. Standing by for future tests.');
      },
      stop: async control => {
        control.markSleeping('Stopping test independent agent.');
      },
      freeze: async () => {
        return { testState: 'frozen-at-idle' };
      },
      thaw: async (_frozenState, control) => {
        control.markSleeping('Thawed from checkpoint. Standing by.');
      },
      onPause: async () => {
        // onPause is for cleanup (e.g. stopping timers), not state changes.
        // The runtime transitions to 'paused' after onPause returns.
      },
      onResume: async control => {
        control.markRunning('Resumed by supervisor.');
      },
      onSuspend: async () => {
        // onSuspend is for cleanup (e.g. stopping timers), not state changes.
        // The runtime transitions to 'sleeping' after onSuspend returns.
      },
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      await independentAgent.start();
    });

    plugin.hooks.onPluginsWillUnload(async () => {
      await independentAgent.stop();
    });
  },
};

export default testAgentsPlugin;
