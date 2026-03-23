import { UserConfig } from './user-config.js'
import { startConversation } from './conversation.js';
import { buildSystemPrompt } from './system-prompts/headers/personality-header.js';
import { getORM } from './memory.js';
import { startServer } from '../web-interface/server/alice-rest-service.js';
import { runManualVoiceDemoLoop } from './voice-turn.js';

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
    // console.log('Checking for a running piper-tts web server on localhost:5002...');
    // TODO: Check if piper-tts web server is running, and start it if not.
    // console.log('Piper-TTS web server is running.');
    // console.log('Checking audio output...');
    // No idea how we even do this in node yet. TBD.
    // console.log('Audio output is working. Playing startup sound.');
    console.log('Initializing memory system.');
    const orm = await getORM();

    // Write a memory to the database about being started up, so we have a record of it in the memory system and it can be referred back to for context in future interactions.

    console.log('Memory system initialized.');
    console.log(`Trying talk to ${config.ollama.model} in Ollama...\n`);
    await (async () => {
      const testConversation = startConversation('startup');
      console.log(` -> Welcome back, ${config.assistantName}`);
      const reply = await testConversation.sendUserMessage();
      console.log(` <- ${reply}`);
    })();
    console.log(`\nTalking to ${config.ollama.model} in Ollama works.`);

    if (process.env.ALICE_VOICE_DEMO === '1') {
      console.log('ALICE_VOICE_DEMO=1 detected. Starting manual voice demo loop.');
      await runManualVoiceDemoLoop();
    }

    // console.log('Checking audio input...');
    // No idea how we even do this in node yet. TBD.
    // console.log('Audio input is working.');
    // console.log('Initializing wake word loop...');
    // This is going to be fun. TBD.
    // console.log('Wake word loop initialized. Alice Assistant is now running and waiting for the wake word...');
    if (!config.webInterface.enabled) {
      // In non-service mode, startup is a one-shot check and exits normally for now.
      // TODO: Once we have the wake word loop and voice interface working, this needs to be removed so previous interaction memory can work.
      await orm.close(true);
      return;
    }

    console.log(`Starting web UI on ${config.webInterface.bindToAddress}:${config.webInterface.port}...`);
    const server = startServer();

    await new Promise<void>((resolve, reject) => {
      let shuttingDown = false;

      const cleanupSignalHandlers = () => {
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
      };

      const shutdown = async (signal: NodeJS.Signals) => {
        if (shuttingDown) {
          return;
        }
        shuttingDown = true;
        console.log(`Received ${signal}, shutting down gracefully...`);
        cleanupSignalHandlers();

        server.close(async (serverErr?: Error) => {
          if (serverErr) {
            reject(serverErr);
            return;
          }

          try {
            await orm.close(true);
            resolve();
          } catch (ormErr) {
            reject(ormErr instanceof Error ? ormErr : new Error(String(ormErr)));
          }
        });
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      server.on('error', (err) => {
        cleanupSignalHandlers();
        reject(err);
      });
    });
  }
}
