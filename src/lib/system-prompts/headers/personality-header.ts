import { UserConfig } from '../../user-config.js';
import { getTools } from '../../../tools/index.js';
import { getSystemInfo } from '../../system-info.js';
import { DynamicPrompt, DynamicPromptConversationType } from '../../dynamic-prompt.js';

export const personalityHeaderPrompt: DynamicPrompt = {
  name: 'personalityHeader',
  weight: -9999,
  getPrompt: async (context) => {
    return await buildSystemPrompt();
  }
};

export async function buildSystemPrompt() {
  const systemPromptChunks: string[] = [];
  // First the heading
  systemPromptChunks.push(`# PC DIGITAL ASSISTANT PERSONALITY AND SYSTEM INFO\n`);
  // Then the intro
  systemPromptChunks.push('## INTRODUCTION\n');
  systemPromptChunks.push(UserConfig.getConfig().personality.INTRO);
  // Then the quirks
  systemPromptChunks.push(`\n## PERSONALITY QUIRKS\n`);
  systemPromptChunks.push(UserConfig.getConfig().personality.QUIRKS);
  // Then any "other" personality files the user has added, each under its own heading.
  Object.keys(UserConfig.getConfig().personality).
    filter((key: string) => key !== 'INTRO' && key !== 'QUIRKS').
    forEach((key: string) => {
      const value = UserConfig.getConfig().personality[key];
      systemPromptChunks.push(`## ${key}\n\n${value}\n`);
    });
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
