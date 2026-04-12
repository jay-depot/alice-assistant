import { AlicePlugin } from '../../../lib.js';

const dailyGoalsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'daily-goals',
    name: 'Daily Goals Plugin',
    description:
      'Allows the assistant to track any daily goals the user requests to ' +
      'set. The assistant should then check in occasionally to see how the user is doing ' +
      'on these goals, and offer encouragement, assistance, or lighthearted mockery as ' +
      'needed. These are different from to-do list items in that they are no longer ' +
      'relevant at the end of the day, even if not completed. A summary of completed items ' +
      'is written to the database at the end of the day, and all incomplete items are ' +
      "cleared. The assistant is given the list of yesterday's completed goals as part " +
      'of the system prompts until it calls the `acknowledgeYesterdaysGoals` tool.',
    version: 'LATEST',

    // If dependencies are declared here, then registerPlugin will not resolve until those
    // dependencies are loaded.
    // If any dependencies are disabled or missing, resulting in an impossible setup, the
    // plugin system should prevent the assistant from starting, and explain why in console
    // output.
    // If any dependencies fail to load for any reason, the plugin system should prevent
    // the assistant from starting, and explain why in console output.
    dependencies: [
      { id: 'memory', version: 'LATEST' },
      { id: 'datetime', version: 'LATEST' },
      { id: 'reminders-broker', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const plugin = await pluginInterface.registerPlugin();
    // Don't get distracted with implementing this until the plugin conversion is done.
    // But this is planned to be one of the better features of this thing, so it's happening soon.
  },
};

export default dailyGoalsPlugin;
