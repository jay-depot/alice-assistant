import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';

const DesktopPeekInputSchema = Type.Object({
  request: Type.String({
    description:
      'What you want to inspect on the desktop. Mention window title or visible UI context when possible.',
  }),
});

type DesktopPeekInput = Type.Static<typeof DesktopPeekInputSchema>;

const desktopPeekPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'desktop-peek',
    name: 'Desktop Peek',
    brandColor: '#59d9a5',
    description: 'Adds the desktop_peek.peek tool for chat and autonomy sessions.',
    version: 'LATEST',
    dependencies: [{ id: 'model-vision', version: 'LATEST' }],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.registerTool({
      name: 'peek',
      availableFor: ['chat', 'autonomy'],
      description:
        'Use desktop_peek.peek when the user asks you to inspect something visible on their desktop or in an image. It clarifies what visual context is needed before analysis.',
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      taintStatus: 'tainted',
      parameters: DesktopPeekInputSchema,
      execute: async (args: Record<string, unknown>) => {
        const input = args as DesktopPeekInput;
        const request = input.request?.trim() || 'the current desktop view';
        return [
          `Desktop peek requested for: ${request}`,
          'If no image is attached yet, ask the user to upload one in chat so vision routing can be used.',
          'Once an image is attached, continue with visual analysis directly.',
        ].join('\n');
      },
    });

    plugin.logger.log('registerPlugin: desktopPeek tool registered.');
  },
};

export default desktopPeekPlugin;
