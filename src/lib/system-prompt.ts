import { UserConfig } from './user-config';
import { tools } from '../tools';
import { getSystemInfo } from './system-info';

export async function buildSystemPrompt(userQuery?: string) {
  const systemPromptChunks: string[] = [];
  // First the heading
  systemPromptChunks.push(`# TASK BRIEFING FOR DIGITAL ASSISTANT: PERSONALITY, TOOLS, CONTEXT, AND SCENARIO\n`);
  // Then the intro
  systemPromptChunks.push('## INTRODUCTION\n');
  systemPromptChunks.push(UserConfig.getConfig().personality.intro);
  // Then the quirks
  systemPromptChunks.push(`\n## PERSONALITY QUIRKS\n`);
  systemPromptChunks.push(UserConfig.getConfig().personality.quirks);
  // Then any "other" personality files the user has added, each under its own heading.
  UserConfig.getConfig().personality.filter((_value: string, key: string) => {
    return key !== 'intro' && key !== 'quirks';
  }).forEach((value: string, key: string) => {
    systemPromptChunks.push(`## ${key}\n\n${value}\n`);
  });
  // Then the additional context (Current date and time, day of the week, location)
  systemPromptChunks.push(`## ADDITIONAL CONTEXT\n`);
  systemPromptChunks.push(`The current date and time are: ${new Date().toLocaleString()}`);
  systemPromptChunks.push(`The current day of the week is: ${new Date().toLocaleString('en-US', { weekday: 'long' })}`);
  systemPromptChunks.push(`The current location is: ${UserConfig.getConfig().location}`);
  // Then some basic host PC system info: OS, CPU, GPU, RAM, Kernel, Desktop Environment, Distribution
  systemPromptChunks.push('## YOUR HOST PC SYSTEM INFO\n');
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
  // Then the TOOLS section, which will list the tools that the assistant has access to, and how to use them.
  if (tools.length > 0) {
    systemPromptChunks.push(`\n## TOOLS\n\nYou have access to tools that can retrieve local data. RULES — follow these EXACTLY:\n`);
    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];
      const fragment = typeof tool.systemPromptFragment === 'function' ? tool.systemPromptFragment() : tool.systemPromptFragment;
      systemPromptChunks.push(` ${i +1} ${fragment}`);
    }
  }
  // Finally the SCENARIO section, which is where we tell the LLM that the assistant has just been activated by wake word, 
  // what the wake word is, the query if there is one, and a few last minute instructions to keep it on track.
  systemPromptChunks.push(`\n## SCENARIO\n`);
  // TODO: Actually remembering users might be cool, instead of assuming like we do here.
  systemPromptChunks.push(` - You have just been activated again by a known user with your wake word "${UserConfig.getConfig().wakeWord}".`);
  if (userQuery) {
    systemPromptChunks.push(`- The user continued the request with the query: "${userQuery}"`);
  }
  systemPromptChunks.push(' - Remember, your response will be synthesized into speech, so keep it punchy and short.');
  systemPromptChunks.push(` - When answering factual questions, go heavy on the facts, and light on the "${UserConfig.getConfig().assistantName} flair."`);
  systemPromptChunks.push(` - When answering other queries, feel free to lean into the "${UserConfig.getConfig().assistantName} flair" more.`);
  systemPromptChunks.push(' - Do not include emotes or descriptions of tone.');
  systemPromptChunks.push(' - If you would need to make a tool call, output ONLY the call signature. Otherwise, respond in character.');

  return systemPromptChunks.join('\n');
}
