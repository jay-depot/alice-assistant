import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const moodPlugin: AlicePlugin = {
  pluginMetadata: {
    name: 'Mood Plugin',
    description: 'Allows the assistant to set a "mood" that is included in the system prompt and used to influence the assistant\'s responses as well as other aspects of how the assistant is presented, including an expression sprite in the web UI.',
    version: 'LATEST',
    dependencies: [],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(moodPlugin.pluginMetadata);
  }
};

export default moodPlugin;
