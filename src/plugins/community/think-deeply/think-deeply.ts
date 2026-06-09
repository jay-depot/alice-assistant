import { AlicePlugin } from '../../../lib.js';
import { Type } from 'typebox';

const thinkDeeplyPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'think-deeply',
    name: 'Think Deeply',
    brandColor: '#ff8a65',
    description:
      'Provides thinkDeeply and returnToNormal tools for switching to a high-capability deep-thinking model mid-session, plus header prompts instructing autonomous use when stuck or asked.',
    version: 'LATEST',
    dependencies: [
      { id: 'llm-provider-broker', version: 'LATEST' },
      { id: 'model-deep-thinking', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const llmProviderBroker = plugin.request('llm-provider-broker');

    if (!llmProviderBroker) {
      throw new Error(
        'Think Deeply: llm-provider-broker is unavailable. Enable llm-provider-broker before think-deeply.'
      );
    }

    // ── Tools ───────────────────────────────────────────────────────

    plugin.registerTool({
      name: 'thinkDeeply',
      availableFor: ['chat', 'voice', 'autonomy'],
      description:
        'Switches the current conversation to your configured deep-thinking model. ' +
        'Use this when you are stuck on a complex problem, the user explicitly asked you to ' +
        'think deeply or reason step-by-step, or when the quality of responses so far has been ' +
        'unsatisfactory for the task at hand. After switching, all subsequent responses in this ' +
        'conversation will use the deep-thinking model until returnToNormal is called.',
      systemPromptFragment:
        'You have access to a thinkDeeply tool that switches to a more capable model for complex reasoning. ' +
        'Call it autonomously when you are stuck, when the user asks you to "think hard" or "reason deeply", ' +
        'or when the conversation requires analytical depth beyond your current capability. ' +
        'You also have a returnToNormal tool to switch back once the deep thinking is no longer needed.',
      taintStatus: 'clean',
      parameters: Type.Object({
        reason: Type.String({
          description:
            'Brief explanation of why deep thinking is needed. This will be logged for context.',
        }),
      }),
      execute: async args => {
        const reason = (args as { reason: string }).reason || 'unspecified';
        llmProviderBroker.setPendingUseForOverride('deep-thinking');
        return (
          `Switched to deep-thinking model. Reason: ${reason}\n` +
          'All subsequent responses in this conversation will use the deep-thinking model ' +
          'until returnToNormal is called.'
        );
      },
    });

    plugin.registerTool({
      name: 'returnToNormal',
      availableFor: ['chat', 'voice', 'autonomy'],
      description:
        'Switches the current conversation back to the normal model after deep thinking is complete. ' +
        'Use this when you have finished the deep-reasoning task and no longer need the more capable model.',
      systemPromptFragment:
        'Call returnToNormal once you have finished the deep-thinking task and want to switch back to the default model.',
      taintStatus: 'clean',
      parameters: Type.Object({}),
      execute: async () => {
        llmProviderBroker.setPendingUseForOverride(undefined);
        return 'Switched back to normal model. Subsequent responses will use the default routing.';
      },
    });

    // ── Header prompt ───────────────────────────────────────────────

    plugin.registerHeaderSystemPrompt({
      name: 'think-deeply-header',
      weight: 500,
      getPrompt: async context => {
        if (!context.availableTools?.includes('thinkDeeply')) {
          return false;
        }
        return (
          '# Deep Thinking Instructions\n\n' +
          'You have the `thinkDeeply` tool available. Use it **autonomously** in these situations:\n\n' +
          '1. **You are stuck** — you have tried a few approaches and none work, or you keep getting error results.\n' +
          '2. **The user asked** — if they say "think harder", "reason deeply", "use your best model", or similar.\n' +
          '3. **High complexity** — the task involves multi-step analysis, coding, mathematical reasoning, or research synthesis.\n\n' +
          'When you use `thinkDeeply`, briefly state why in the `reason` parameter so the context is clear.\n' +
          'Once the deep-thinking model resolves the issue or is no longer needed, call `returnToNormal` to switch back.\n\n' +
          'If `deep-thinking` is not configured in llm.models, `thinkDeeply` will report a warning — work within your current limits.'
        );
      },
    });

    plugin.logger.log(
      'registerPlugin: thinkDeeply and returnToNormal tools registered.'
    );
  },
};

export default thinkDeeplyPlugin;
