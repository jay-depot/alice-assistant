import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

declare module '../../lib/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    mood: {
      getMood: () => Promise<{ mood: string; reason: string }>; // returns the assistant's current mood and the reason for that mood, or an empty string if no mood is set.
    }
  }
};

const moodPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'mood',
    name: 'Mood Plugin',
    description: 'Allows the assistant to set a "mood" that is included in the system prompt and used to influence the assistant\'s responses as well as other aspects of how the assistant is presented, including an expression sprite in the web UI.',
    version: 'LATEST',
    dependencies: [],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(moodPlugin.pluginMetadata);
    const currentMood: { mood: string; reason: string } = { mood: 'neutral', reason: 'Default on assistant startup' };

    // TODO: Bring over mood save/load from original tool definition.

    plugin.offer<'mood'>({
      getMood: () => {
        return Promise.resolve(currentMood);
      }
    });
  }
};

export default moodPlugin;
