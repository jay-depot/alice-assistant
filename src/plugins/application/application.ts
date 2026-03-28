import { AlicePlugin } from '../../lib/types/alice-plugin-interface.js';
import { openApplicationTool } from './tool.js';

const applicationPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'application',
    name: 'Application Plugin',
    description: 'Provides the assistant with tools to launch applications on behalf ' +
      'of the user on their system.',
    version: 'LATEST',
    dependencies: [], 
    // user-files is probably recommended though. Should we make "recommended" 
    // dependencies a thing? How would that info be surfaced to the user if so?
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(applicationPlugin.pluginMetadata);

    plugin.registerTool(openApplicationTool);
  }

};

export default applicationPlugin;
