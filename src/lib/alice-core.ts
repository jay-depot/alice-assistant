import { UserConfig } from './user-config.js';
import { startConversation } from './conversation.js';
import { loadPlugins } from './alice-plugin-loader.js';
import { PluginHookInvocations } from './plugin-hooks.js';
import { AlicePluginEngine } from './alice-plugin-engine.js';
import { describeLlmModel, getFallbackLlmModel } from './llm-provider.js';
import { systemLogger } from './system-logger.js';

export const AliceCore = {
  waitForShutdownSignal: () => {
    return new Promise<void>(resolve => {
      systemLogger.log(
        'Entering main loop. Press Ctrl+C or send SIGTERM to exit.'
      );
      let shuttingDown = false;
      const cleanupSignalHandlers = () => {
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
      };

      const shutdown = async (signal: NodeJS.Signals) => {
        if (shuttingDown) {
          return;
        }
        // Print a single newline to separate the shutdown logs from the ^C in the console.
        // This should be the only console.log left in the code, outside of the logging helpers.
        console.log();
        shuttingDown = true;
        systemLogger.log(`\nReceived ${signal}, shutting down gracefully...`);
        cleanupSignalHandlers();
        await PluginHookInvocations.invokeOnAssistantWillStopAcceptingRequests();
        await PluginHookInvocations.invokeOnAssistantStoppedAcceptingRequests();
        await PluginHookInvocations.invokeOnPluginsWillUnload();
        AlicePluginEngine.cleanupWebSocketServers();
        systemLogger.log(
          'All plugins have been notified of shutdown. Exiting now.'
        );
        resolve();
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
  },

  start: async () => {
    const configPath = UserConfig.getConfigPath(); // I'm probably going to pass this into the LLM context at some point? IDK, might be fun.
    systemLogger.log(
      `ALICE Assistant starting with config path: ${configPath}`
    );
    UserConfig.load();
    const config = UserConfig.getConfig();

    if (config.assistantName !== 'ALICE') {
      systemLogger.log(`Oh! I'm actually named ${config.assistantName}.`);
    }

    systemLogger.log('Config loaded successfully.');
    await loadPlugins();
    const fallbackModel = getFallbackLlmModel(config);
    systemLogger.log(
      `Trying talk to ${describeLlmModel(fallbackModel)} through the active fallback provider...\n`
    );

    // Validate Ollama connectivity with a startup-type conversation before accepting
    // external requests. The REST server is not yet listening at this point — this is
    // an internal-only connectivity check. If the LLM is unreachable or produces a
    // degenerate response, the assistant will fail fast before opening any ports.
    await PluginHookInvocations.invokeOnAssistantWillAcceptRequests();
    await (async () => {
      const testConversation = startConversation('startup');
      systemLogger.log(` -> Welcome back, ${config.assistantName}`);
      const reply = await testConversation.sendUserMessage();
      systemLogger.log(` <- ${reply}`);
    })();
    systemLogger.log(`\nTalking to ${describeLlmModel(fallbackModel)} works.`);

    await PluginHookInvocations.invokeOnAssistantAcceptsRequests();

    if (process.env.ALICE_SMOKE_TEST) {
      systemLogger.log(
        'ALICE_SMOKE_TEST is set — running clean shutdown and exiting.'
      );
      await PluginHookInvocations.invokeOnAssistantWillStopAcceptingRequests();
      await PluginHookInvocations.invokeOnAssistantStoppedAcceptingRequests();
      await PluginHookInvocations.invokeOnPluginsWillUnload();
      AlicePluginEngine.cleanupWebSocketServers();
      systemLogger.log('Smoke test shutdown complete. Exiting successfully.');
      return;
    }

    await AliceCore.waitForShutdownSignal();
  },
};
