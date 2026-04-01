import { Type } from 'typebox';
import { AlicePlugin } from '../../lib.js';
import systemHealthCheckTool from './tools/system-health.js';

const SystemInfoPluginConfigSchema = Type.Object({
  mustMentionIfNetworkDown: Type.Boolean({
    description: 'Whether the assistant must mention in its response if the network connectivity status is "disconnected" or "limited" in the results of the systemHealthCheck tool.',
    default: true,
  }),
});

export type SystemInfoPluginConfigSchema = Type.Static<typeof SystemInfoPluginConfigSchema>;

const systemInfoPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'system-info',
    name: 'System Info Plugin',
    description: 'Provides the assistant with information about the system it is running on, ' +
      'including but not limited to: system resources (CPU, memory, disk usage), operating ' +
      'system information, and other relevant details. This information can be used by the ' +
      'assistant to make informed decisions about how to handle tasks, manage resources, and ' +
      'provide better responses to the user. Also provides the assistant with a systemHealth ' +
      'tool that can be called to get a report on the current health of the system, including ' +
      'resource usage and any potential issues that may be affecting performance.',
    version: 'LATEST',
    dependencies: [],
    required: true,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(systemInfoPlugin.pluginMetadata);

    const config = await plugin.config(SystemInfoPluginConfigSchema, {
      mustMentionIfNetworkDown: true,
    });

    plugin.registerTool(systemHealthCheckTool(config.getPluginConfig()));
  }
};

export default systemInfoPlugin;
