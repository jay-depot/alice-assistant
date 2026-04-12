import { UserConfig } from './user-config.js';
import { startConversation } from './conversation.js';
import { loadPlugins } from './alice-plugin-loader.js';
import { PluginHookInvocations } from './plugin-hooks.js';

export const AliceCore = {
  waitForShutdownSignal: () => {
    return new Promise<void>(resolve => {
      // This is a dummy loop to keep the assistant running until I
      // add the actual voice loop.
      console.log('Entering main loop. Press Ctrl+C to exit.');
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
        console.log(`\nReceived ${signal}, shutting down gracefully...`);
        cleanupSignalHandlers();
        await PluginHookInvocations.invokeOnAssistantWillStopAcceptingRequests();
        await PluginHookInvocations.invokeOnAssistantStoppedAcceptingRequests();
        await PluginHookInvocations.invokeOnPluginsWillUnload();
        console.log('All plugins have been notified of shutdown. Exiting now.');
        resolve();
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
  },

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

    await AliceCore.waitForShutdownSignal();
  },
};
