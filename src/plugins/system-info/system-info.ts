import { Type } from 'typebox';
import { AlicePlugin } from '../../lib.js';
import systemHealthCheckTool from './tools/system-health.js';
import { getSystemInfo } from './get-system-info.js';

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

    plugin.registerHeaderSystemPrompt({
      name: 'systemInfoHeader',
      weight: -1,
      getPrompt: async (context) => {
        const systemPromptChunks: string[] = [];
        // Then some basic host PC system info: OS, CPU, GPU, RAM, Kernel, Desktop Environment, Distribution
        systemPromptChunks.push('\n## YOUR HOST PC SYSTEM INFO\n');
        const systemInfo = await getSystemInfo();
        systemPromptChunks.push(` - OS: ${systemInfo.os}`);
        systemPromptChunks.push(` - Distribution: ${systemInfo.distribution}`);
        systemPromptChunks.push(` - Kernel: ${systemInfo.kernel}`);
        systemPromptChunks.push(` - CPU: ${systemInfo.cpu}`);
        systemPromptChunks.push(` - Physical Cores: ${systemInfo.physicalCores}`);
        systemPromptChunks.push(` - Threads: ${systemInfo.threadCount}`);
        systemPromptChunks.push(` - RAM: ${systemInfo.totalMemory} ${systemInfo.totalMemoryUnit}`);
        systemPromptChunks.push(` - GPU: ${systemInfo.gpuModel || 'Unknown'}`);
        systemPromptChunks.push(` - VRAM: ${systemInfo.vramSize || 'Unknown'} ${systemInfo.vramSizeUnit || ''}`);
        systemPromptChunks.push(` - Desktop Environment: ${systemInfo.desktopEnvironment}`);
        systemPromptChunks.push(` - Window Manager: ${systemInfo.windowManager}`);
        systemPromptChunks.push(` - Graphical Server: ${systemInfo.graphicalServer}`);
        systemPromptChunks.push(` - Display Size: ${systemInfo.displaySize}`);
        systemPromptChunks.push(` - Shell: ${systemInfo.shell}`);
        systemPromptChunks.push(` - Terminal: ${systemInfo.terminal}`);
        systemPromptChunks.push(` - Hostname: ${systemInfo.hostname}`);
        systemPromptChunks.push(` - Locale: ${systemInfo.locale}`);
        systemPromptChunks.push(` - Timezone: ${systemInfo.timezone}`);

        return systemPromptChunks.join('\n');
      }
    });

    plugin.registerTool(systemHealthCheckTool(config.getPluginConfig()));
  }
};

export default systemInfoPlugin;
