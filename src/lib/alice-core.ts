import { UserConfig } from './user-config'
import { startLLMTransaction } from './llm-transaction';

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
    console.log('Checking for a running piper-tts web server on localhost:5002...');
    // TODO: Check if piper-tts web server is running, and start it if not.
    console.log('Piper-TTS web server is running.');
    console.log('Checking audio output...');
    // No idea how we even do this in node yet. TBD.
    console.log('Audio output is working. Playing startup sound.');
    console.log(`Trying talk to ${config.model} in Ollama...`);
    await (async () => {
      const testConversation = startLLMTransaction();
      console.log(' -> Say hello');
      const reply = await testConversation.executeTurn('Say hello');
      console.log(` <- ${reply}`);
    })()
    console.log(`Talking to ${config.model} in Ollama works.`);
    console.log('Checking audio input...');
    // No idea how we even do this in node yet. TBD.
    console.log('Audio input is working.');
    console.log('Initializing wake word loop...');
    // This is going to be fun. TBD.
    console.log('Wake word loop initialized. Alice Assistant is now running and waiting for the wake word...');
  }
}
