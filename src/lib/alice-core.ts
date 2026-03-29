import { UserConfig } from './user-config.js'
import { startConversation } from './conversation.js';
import { runManualVoiceDemoLoop } from './voice-turn.js';
import { loadPlugins } from './alice-plugin-loader.js';
import { PluginHookInvocations } from './plugin-hooks.js';

export const AliceCore = {
  start: async () => {
    const configPath = UserConfig.getConfigPath(); // I'm probably going to pass this into the LLM context at some point? IDK, might be fun.
    console.log(`ALICE Assistant starting with config path: ${configPath}`);
    UserConfig.load();
    const config = UserConfig.getConfig();
    
    if (config.assistantName !== 'ALICE') {
      console.log(`Oh! I'm actually named ${config.assistantName}.`);
    }
    
    console.log('Config loaded successfully.');
    await loadPlugins();
    console.log(`Trying talk to ${config.ollama.model} in Ollama...\n`);
    await PluginHookInvocations.invokeOnAssistantWillAcceptRequests();
    await (async () => {
      const testConversation = startConversation('startup');
      console.log(` -> Welcome back, ${config.assistantName}`);
      const reply = await testConversation.sendUserMessage();
      console.log(` <- ${reply}`);
    })();
    console.log(`\nTalking to ${config.ollama.model} in Ollama works.`);
    await PluginHookInvocations.invokeOnAssistantAcceptsRequests();

    if (process.env.ALICE_VOICE_DEMO === '1') {
      console.log('ALICE_VOICE_DEMO=1 detected. Starting manual voice demo loop.');
      await runManualVoiceDemoLoop();
    }
  }
}
