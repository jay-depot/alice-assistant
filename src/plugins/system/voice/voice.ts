import { AlicePlugin } from '../../../lib.js';
import path from 'node:path';
import { Type } from 'typebox';
import { UserConfig } from '../../../lib/user-config.js';
import { createVoiceAccessToken } from './auth.js';
import { VoicePluginConfigSchema, defaultVoicePluginConfig } from './config.js';
import {
  createManagedVoiceClientState,
  startManagedVoiceClient,
  stopManagedVoiceClient,
} from './managed-client.js';
import {
  closeActiveVoiceSession,
  flushDeferredVoiceSessionCloses,
  requestActiveVoiceConversationEnd,
  registerVoiceRoutes,
  type VoicePluginRuntimeState,
} from './routes.js';

const currentDir = import.meta.dirname;

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

    const runtimeState: VoicePluginRuntimeState = {
      accessToken: null as string | null,
      managedClientState: createManagedVoiceClientState(),
      activeVoiceSession: null,
      sessionIdleTimeoutMs: (config.getPluginConfig().sessionIdleTimeoutMinutes ?? 10) * 60_000,
      deferredSessionCloseDelayMs: 0,
      pendingVoiceSessionCloses: new Set(),
      captureDebugConfig: {
        minCaptureSeconds: config.getPluginConfig().minCaptureSeconds ?? 1.25,
        maxCaptureSeconds: config.getPluginConfig().maxCaptureSeconds ?? 7,
        trailingSilenceMs: config.getPluginConfig().trailingSilenceMs ?? 900,
        speechThreshold: config.getPluginConfig().speechThreshold ?? 0.015,
        prerollMs: config.getPluginConfig().prerollMs ?? 250,
      },
      lastCaptureDebug: null,
      nextVoiceClientEventSequence: 1,
      voiceClientEvents: [],
    };

    plugin.registerTool({
      name: 'endVoiceConversation',
      availableFor: ['voice'],
      description: 'Use endVoiceConversation only when the user clearly indicates the conversation is over, such as saying that will be all, that is it, or thanks that is all. Do not call it just because a task is complete if the user still appears to be engaged.',
      systemPromptFragment: '',
      parameters: Type.Object({}),
      toolResultPromptIntro: 'The current voice conversation has been marked to end right after your current reply is spoken.',
      toolResultPromptOutro: 'Give a brief wrap-up reply. Do not ask a follow-up question, do not invite the user to continue, and do not imply that you are still waiting for another turn.',
      execute: async (_args, context) => {
        if (context.conversationType !== 'voice') {
          throw new Error('endVoiceConversation can only be used during voice conversations.');
        }

        return requestActiveVoiceConversationEnd(runtimeState)
          ? 'The current voice conversation will end after your reply is delivered.'
          : 'No active voice conversation was available to end.';
      },
    });

    registerVoiceRoutes(webUi.express, runtimeState);

    const closeVoiceRuntime = async () => {
      console.log('voice plugin: shutting down voice runtime.');

      if (runtimeState.activeVoiceSession) {
        console.log('voice plugin: closing final active voice conversation during shutdown.');
      }

      await closeActiveVoiceSession(runtimeState);

      if (runtimeState.pendingVoiceSessionCloses.size > 0) {
        console.log(
          `voice plugin: waiting for ${runtimeState.pendingVoiceSessionCloses.size} deferred voice conversation cleanup task(s) to finish.`,
        );
      }

      await flushDeferredVoiceSessionCloses(runtimeState);

      console.log('voice plugin: stopping managed voice client.');
      await stopManagedVoiceClient(runtimeState.managedClientState);
      runtimeState.accessToken = null;
      console.log('voice plugin: voice runtime shutdown complete.');
    };

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
      await closeVoiceRuntime();
    });

    plugin.hooks.onPluginsWillUnload(async () => {
      await closeVoiceRuntime();
    });
  },
};

export default voicePlugin;
