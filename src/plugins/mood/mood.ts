import { Type } from 'typebox';
import { AlicePlugin } from '../../lib.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { UserConfig } from '../../lib/user-config.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

declare module '../../lib.js' {
  export interface PluginCapabilities {
    mood: {
      /** Returns the assistant's current mood and the reason for that mood, or an empty string if no mood is set. */
      getMood: () => Promise<{ mood: string; reason: string }>; 
    }
  }
};

// TODO: Moonshot goal: Is there some kind of open source "Autotune" I could pipe the TTS output through? 
// It would both convey these moods, and give the voice that sing-songy "GLaDOS" vibe that I'm totally not going for, I swear.
export const AllowedMoods = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'annoyed',
  'anxious',
  'ashamed',
  'bored',
  'calm',
  'confident',
  'content',
  'cheerful',
  'chipper',
  'confused',
  'curious',
  'disappointed',
  'disgusted',
  'excited',
  'focused',
  'frustrated',
  'grateful',
  'gleeful',
  'giddy',
  'gloomy',
  'grumpy',
  'imperious',
  'indifferent',
  'impressed',
  'inspired',
  'melancholy',
  'lonely',
  'nervous',
  'playful',
  'proud',
  'relaxed',
  'sardonic',
  'sassy',
  'satisfied',
  'scared',
  'self-righteous',
  'serious',
  'servile',
  'stressed',
  'surprised',
  'tired',
  'unimpressed',
] as const;

const SetMoodParameters = Type.Object({ 
  mood: Type.Union(AllowedMoods.map((mood) => Type.Literal(mood))),
  reason: Type.String(),
});

const moodPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'mood',
    name: 'Mood Plugin',
    description: 'Allows the assistant to set a "mood" that is included in the system prompt and used to influence the assistant\'s responses as well as other aspects of how the assistant is presented, including an expression sprite in the web UI.',
    version: 'LATEST',
    dependencies: [{ id: 'web-ui', version: 'LATEST' }],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const webUi = plugin.request('web-ui');
    const currentMood: { mood: string; reason: string } = { mood: 'neutral', reason: 'Default on assistant startup' };


    const configPath = UserConfig.getConfigPath();
    const toolConfigPath = path.join(configPath, 'tool-settings', 'setMood');
  
    if (fs.existsSync(toolConfigPath)) {
      try {
        const lastMoodData = JSON.parse(fs.readFileSync(path.join(toolConfigPath, 'last-mood.json'), 'utf-8'));
        currentMood.mood = lastMoodData.mood || currentMood.mood;
        currentMood.reason = lastMoodData.reason || currentMood.reason;
      } catch (error) {
        console.warn('Error reading last mood data:', error);
      }
    }

    function saveMood(mood: string, reason: string) {
      const moodData = { mood, reason };
      fs.mkdirSync(toolConfigPath, { recursive: true });
      fs.writeFileSync(path.join(toolConfigPath, 'last-mood.json'), JSON.stringify(moodData), 'utf-8');
    }

    if (webUi) {
      webUi.express.get('/api/mood', async (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ mood: currentMood.mood });
      });

      // Register the browser bundle built from `mood-web-ui.ts`.
      webUi.registerScript(path.join(currentDir, 'mood-web-ui.js'));
    }

    // TODO: Bring over mood save/load from original tool definition.

    plugin.offer<'mood'>({
      getMood: () => {
        return Promise.resolve(currentMood);
      }
    });

    plugin.registerTool({
      name: 'setMood',
      availableFor: ['chat', 'voice', 'autonomy', 'startup'],
      description: `Sets the assistant's mood. The mood is a string that describes the tone of the ` +
        `assistant's current responses. It is also used to inform the manner in which the assistant's ` +
        `responses are delivered to the user. The allowed moods you can set are: ${AllowedMoods.join(', ')}.`,
      parameters: SetMoodParameters,
      systemPromptFragment: `The assistant has a mood, which is a string that describes tone and delivery of ` +
        `the assistant's responses. The mood can be set by calling the setMood tool with the new mood and a ` +
        `reason for the change. Use this freely to enhance the delivery of your character. Allowed moods are: ` +
        `${AllowedMoods.join(', ')}.`,
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (args) => {
        const { mood, reason } = args as { mood: string; reason: string };
        currentMood.mood = mood;
        currentMood.reason = reason;
        saveMood(mood, reason);
        return `You have successfully changed your mood to ${mood}, for reason: ${reason}`;
      }
    });

    plugin.registerFooterSystemPrompt({
      name: 'moodFooter',
      weight: 0,
      getPrompt: async (context) => {
        if (context.conversationType === 'autonomy') {
          return false;
        }
        return `\n## MOOD\n\n` +
          `You have a mood, which is a string that describes the tone of your responses. It is also ` +
          `used to inform the manner in which your responses are delivered to the user.\n` +
          `Your current mood is: ${currentMood.mood}. \n` +
          `The reason for your current mood is: ${currentMood.reason}. \n` +
          `Feel free to change your mood as often as you like, and use it to influence the tone and ` +
          `style of your responses. For example, if your mood is set to "happy", you might respond ` +
          `in a more cheerful and upbeat manner, while if your mood is set to "sassy", you might ` +
          `respond in a more sarcastic and playful manner.`;
      }
    });
  }
};

export default moodPlugin;
