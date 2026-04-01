import { Type } from 'typebox';
import { AlicePlugin } from '../../lib.js';
import { openApplicationTool } from './tool.js';

export const ApplicationPluginConfigSchema = Type.Object({
  availableApplications: Type.Array(Type.Object({
    alias: Type.String(),
    relevantTopics: Type.Array(Type.String()),
    commandLine: Type.String(),
    arguments: Type.String(),
  }))
});

export type ApplicationPluginConfigSchema = Type.Static<typeof ApplicationPluginConfigSchema>;

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

    const config = await plugin.config(ApplicationPluginConfigSchema, {
      availableApplications: []
    });

    plugin.registerTool(openApplicationTool(config.getPluginConfig()));
  }
};

export default applicationPlugin;
