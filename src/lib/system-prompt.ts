import { UserConfig } from './user-config';
import { getTools } from '../tools';
import { getSystemInfo } from './system-info';
import { AllowedMoods, getMood } from 'tools/set-mood';

type PromptScenario = 'voice' | 'chat' | 'startup';

export async function buildSystemPrompt(scenario: PromptScenario = 'voice', userQuery?: string) {
  const systemPromptChunks: string[] = [];
  // First the heading
  systemPromptChunks.push(`# TASK BRIEFING FOR DIGITAL ASSISTANT: PERSONALITY, TOOLS, CONTEXT, AND SCENARIO\n`);
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
  // Then the additional context (Current date and time, day of the week, location)
  systemPromptChunks.push(`## ADDITIONAL CONTEXT\n`);
  systemPromptChunks.push(`The current date and time are: ${new Date().toLocaleString()}`);
  systemPromptChunks.push(`The current day of the week is: ${new Date().toLocaleString('en-US', { weekday: 'long' })}`);
  systemPromptChunks.push(`The current location is: ${UserConfig.getConfig().location}`);
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
  // Then the TOOLS section, which will list the tools that the assistant has access to, and how to use them.
  const tools = getTools();
  if (tools.length > 0) {
    systemPromptChunks.push(`\n## TOOLS\n\nYou have access to tools that can retrieve local data. RULES — follow these EXACTLY:\n`);
    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];
      const fragment = typeof tool.systemPromptFragment === 'function' ? tool.systemPromptFragment() : tool.systemPromptFragment;
      systemPromptChunks.push(` ${i +1} ${fragment}`);
    }
  }

  // A mood section, if that tool is enabled.
  if (UserConfig.getConfig().enabledTools['setMood']) {
    systemPromptChunks.push(`\n## MOOD\n\nYou have a mood, which is a string that describes the tone of your ` +
      `responses. It is also used to inform the manner in which your responses are delivered to the user. Your ` +
      `current mood is ${getMood()}, and you may change your mood by calling the setMood tool ` +
      `before responding. The allowed moods you can set are: ${AllowedMoods.join(', ')}. Feel free to change ` +
      `your mood as often as you like, and use it to influence the tone and style of your responses. For ` +
      `example, if your mood is set to "happy", you might respond in a more cheerful and upbeat manner, while ` +
      `if your mood is set to "sassy", you might respond in a more sarcastic and playful manner.`);
  }

  // Finally the SCENARIO section, which is where we tell the LLM that the assistant has just been activated by wake word, 
  // what the wake word is, the query if there is one, and a few last minute instructions to keep it on track.
  systemPromptChunks.push(`\n## SCENARIO\n`);
  // TODO: Actually remembering users might be cool, instead of assuming like we do here.

  switch (scenario) {
    case 'voice':
      systemPromptChunks.push(` - You have just been activated again by a known user with your wake word "${UserConfig.getConfig().wakeWord}".`);
      if (userQuery) {
        systemPromptChunks.push(`- The user continued the request with the query: "${userQuery}"`);
      }
      systemPromptChunks.push(' - Remember, your response will be synthesized into speech, so keep it punchy and short.');
      systemPromptChunks.push(` - When answering factual questions, go heavy on the facts, and light on the "${UserConfig.getConfig().assistantName} flair."`);
      systemPromptChunks.push(` - When answering other queries, feel free to lean into the "${UserConfig.getConfig().assistantName} flair" more.`);
      systemPromptChunks.push(' - Your answer MUST be only your response. Do not include emotes or descriptions of tone. Do not include narration.');
      systemPromptChunks.push(' - Get to the heart of the response first, then inject a bit of flair.')
      if (tools.length > 0) {
        systemPromptChunks.push(' - If you are making a tool call, output ONLY the call signature AND NOTHING ELSE. OTHERWISE, RESPOND IN CHARACTER NOW.');
      } else {
        systemPromptChunks.push(' - Respond in character.');
      }

      return systemPromptChunks.join('\n');
    case 'chat':
      systemPromptChunks.push(` - You have been invoked in an alternative text-based chat interface.`);
      systemPromptChunks.push(` - When answering factual questions, go heavy on the facts, and light on the "${UserConfig.getConfig().assistantName} flair."`);
      systemPromptChunks.push(` - When answering other queries, feel free to lean into the "${UserConfig.getConfig().assistantName} flair" more.`);
      systemPromptChunks.push(' - Your answer MUST be only your response. Do not include emotes or descriptions of tone. Do not include narration.');
      systemPromptChunks.push(' - Get to the heart of the response first, then inject a bit of flair.')
      if (tools.length > 0) {
        systemPromptChunks.push(' - If you are making a tool call, output ONLY the call signature AND NOTHING ELSE. OTHERWISE, GREET THE USER IN CHARACTER NOW.');
      } else {
        systemPromptChunks.push(' - Greet the user in character.');
      }

      return systemPromptChunks.join('\n');
    case 'startup':
      systemPromptChunks.push(` - You are a digital assistant application that has just been restarted and is now waiting for user requests.`);
      systemPromptChunks.push(` - Respond with no more than 2 or 3 sentences. They will appear in the assistant application log.`);
      systemPromptChunks.push(` - A quick status report would be approprate here.`);
      if (tools.length > 0) {
        systemPromptChunks.push(' - If you are making a tool call, output ONLY the call signature AND NOTHING ELSE. OTHERWISE, INTRODUCE YOURSELF IN CHARACTER NOW.');
      } else {
        systemPromptChunks.push(' - Introduce yourself in character.');
      }

      return systemPromptChunks.join('\n');
  }
}
