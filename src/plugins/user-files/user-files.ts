import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const userFilesPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'user-files',
    name: 'User Files Plugin',
    description: 'Provides the assistant with tools to read the user\'s filesystem, ' +
      'within limits set by the user in the plugin configuration. Does not allow the ' +
      'assistant to access hidden files or folders, and does not allow the assistant to ' +
      'access any files or folders outside of the user-specified allowed folders or file types.',
    version: 'LATEST',
    dependencies: [],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(userFilesPlugin.pluginMetadata);
  }
};

export default userFilesPlugin;
