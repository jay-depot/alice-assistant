import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

const systemInfoPlugin: AlicePlugin = {
  pluginMetadata: {
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
  }
};

export default systemInfoPlugin;
