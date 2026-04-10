import { AlicePlugin } from '../../../lib.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserConfig } from '../../../lib/user-config.js';
import { createVoiceAccessToken } from './auth.js';
import { VoicePluginConfigSchema, defaultVoicePluginConfig } from './config.js';
import {
  createManagedVoiceClientState,
  startManagedVoiceClient,
  stopManagedVoiceClient,
} from './managed-client.js';
import { registerVoiceRoutes } from './routes.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const voicePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'voice',
    name: 'Voice',
    description: 'Provides token-protected local voice endpoints and supervises the managed local voice client.',
    version: 'LATEST',
    dependencies: [
      { id: 'web-ui', version: 'LATEST' },
    ],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config(VoicePluginConfigSchema, defaultVoicePluginConfig);
    const webUi = plugin.request('web-ui');

    if (!webUi) {
      throw new Error('voice plugin could not access the web-ui plugin capabilities. Disable voice or fix the web-ui plugin to continue.');
    }

    const runtimeState = {
      accessToken: null as string | null,
      managedClientState: createManagedVoiceClientState(),
    };

    registerVoiceRoutes(webUi.express, runtimeState);

    plugin.hooks.onAssistantWillAcceptRequests(async () => {
      runtimeState.accessToken = createVoiceAccessToken();
      console.log('voice plugin: generated local access token for managed voice client.');
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      if (!runtimeState.accessToken) {
        throw new Error('voice plugin could not launch the managed voice client because no access token was initialized.');
      }

      const systemConfig = UserConfig.getConfig();
      const baseUrl = `http://${systemConfig.webInterface.bindToAddress}:${systemConfig.webInterface.port}`;

      startManagedVoiceClient({
        config: config.getPluginConfig(),
        token: runtimeState.accessToken,
        baseUrl,
        wakeWord: systemConfig.wakeWord,
        clientScriptPath: path.join(currentDir, 'client', 'alice-voice-client.py'),
        state: runtimeState.managedClientState,
      });
    });

    plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
      await stopManagedVoiceClient(runtimeState.managedClientState);
      runtimeState.accessToken = null;
    });

    plugin.hooks.onPluginsWillUnload(async () => {
      await stopManagedVoiceClient(runtimeState.managedClientState);
      runtimeState.accessToken = null;
    });
  },
};

export default voicePlugin;