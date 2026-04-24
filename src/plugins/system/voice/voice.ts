import { AlicePlugin } from '../../../lib.js';
import path from 'node:path';
import { Type } from 'typebox';
import { UserConfig } from '../../../lib/user-config.js';
import { createVoiceAccessToken } from './auth.js';
import { VoicePluginConfigSchema, defaultVoicePluginConfig } from './config.js';
import { VoiceSession, VoiceSessionRound } from './db-schemas/index.js';
import { VoiceSessionStore } from './voice-session-store.js';
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
    brandColor: '#b95677',
    description:
      'Provides token-protected local voice endpoints and supervises the managed local voice client.',
    version: 'LATEST',
    dependencies: [
      { id: 'rest-serve', version: 'LATEST' },
      { id: 'memory', version: 'LATEST' },
    ],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config(
      VoicePluginConfigSchema,
      defaultVoicePluginConfig
    );
    const restServe = plugin.request('rest-serve');

    if (!restServe) {
      throw new Error(
        'voice plugin could not access the rest-serve plugin capabilities. Disable voice or fix the rest-serve plugin to continue.'
      );
    }

    const memory = plugin.request('memory');

    if (!memory) {
      throw new Error(
        'voice plugin could not access the memory plugin capabilities. Disable voice or fix the memory plugin to continue.'
      );
    }

    memory.registerDatabaseModels([VoiceSession, VoiceSessionRound]);

    const runtimeState: VoicePluginRuntimeState = {
      accessToken: null as string | null,
      managedClientState: createManagedVoiceClientState(),
      orm: null,
      activeVoiceSessionId: null,
      activeVoiceSession: null,
      sessionIdleTimeoutMs:
        (config.getPluginConfig().sessionIdleTimeoutMinutes ?? 10) * 60_000,
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
      description:
        'Use endVoiceConversation only when the user clearly indicates the conversation is over, such as saying "that will be all," "that is it," or "thanks, that is all." Do not call it just because a task is complete if the user still appears to be engaged.',
      systemPromptFragment: '',
      parameters: Type.Object({}),
      toolResultPromptIntro:
        'The current voice conversation has been marked to end right after your current reply is spoken.',
      toolResultPromptOutro:
        'Give a brief wrap-up reply. Do not ask a follow-up question, do not invite the user to continue, and do not imply that you are still waiting for another turn.',
      execute: async (_args, context) => {
        if (context.conversationType !== 'voice') {
          throw new Error(
            'endVoiceConversation can only be used during voice conversations.'
          );
        }

        return requestActiveVoiceConversationEnd(runtimeState)
          ? 'The current voice conversation will end after your reply is delivered.'
          : 'No active voice conversation was available to end.';
      },
    });

    registerVoiceRoutes(restServe.express, runtimeState);

    // Initialize the ORM once the memory plugin has the database ready.
    memory.onDatabaseReady(async orm => {
      runtimeState.orm = orm;
      plugin.logger.log(
        'voice plugin: database ORM initialized, voice session persistence available.'
      );

      // Recover from unclean shutdowns: any sessions still marked as
      // 'active' in the DB are stale (the app restarted), so set them
      // aside so they can be offered for resume on the next wake-word.
      try {
        const activeSessions = await VoiceSessionStore.getActiveSession(orm);
        if (activeSessions) {
          plugin.logger.log(
            `voice plugin: found stale active session ${activeSessions.id} from previous run, setting it aside.`
          );
          await VoiceSessionStore.updateSession(orm, activeSessions.id, {
            status: 'set_aside',
          });
        }
      } catch (error) {
        plugin.logger.error(
          'voice plugin: failed to recover stale active sessions:',
          error
        );
      }
    });

    const closeVoiceRuntime = async () => {
      plugin.logger.log('voice plugin: shutting down voice runtime.');

      // Persist the active voice session to the database before shutdown
      // so it can be resumed after a restart.
      if (
        runtimeState.activeVoiceSession &&
        runtimeState.orm &&
        runtimeState.activeVoiceSessionId
      ) {
        plugin.logger.log(
          'voice plugin: persisting active voice conversation to database before shutdown.'
        );
        try {
          const session = await VoiceSessionStore.getSession(
            runtimeState.orm,
            runtimeState.activeVoiceSessionId
          );
          if (session) {
            await VoiceSessionStore.persistUnsynchronizedMessages(
              runtimeState.orm,
              session,
              runtimeState.activeVoiceSession.conversation
            );
            await VoiceSessionStore.setAsideSession(
              runtimeState.orm,
              runtimeState.activeVoiceSessionId,
              runtimeState.activeVoiceSession.conversation
            );
            plugin.logger.log(
              `voice plugin: set aside voice session ${runtimeState.activeVoiceSessionId} for potential resume after restart.`
            );
          }
        } catch (error) {
          plugin.logger.error(
            'voice plugin: failed to persist active voice session before shutdown:',
            error
          );
        }
        // Clear the in-memory state regardless of persistence success
        runtimeState.activeVoiceSession = null;
        runtimeState.activeVoiceSessionId = null;
      } else if (runtimeState.activeVoiceSession) {
        plugin.logger.log(
          'voice plugin: closing final active voice conversation during shutdown (no database available).'
        );
        await closeActiveVoiceSession(runtimeState);
      }

      if (runtimeState.pendingVoiceSessionCloses.size > 0) {
        plugin.logger.log(
          `voice plugin: waiting for ${runtimeState.pendingVoiceSessionCloses.size} deferred voice conversation cleanup task(s) to finish.`
        );
      }

      await flushDeferredVoiceSessionCloses(runtimeState);

      plugin.logger.log('voice plugin: stopping managed voice client.');
      await stopManagedVoiceClient(runtimeState.managedClientState);
      runtimeState.accessToken = null;
      plugin.logger.log('voice plugin: voice runtime shutdown complete.');
    };

    plugin.hooks.onAssistantWillAcceptRequests(async () => {
      plugin.logger.log(
        'onAssistantWillAcceptRequests: Starting managed voice access token initialization.'
      );
      runtimeState.accessToken = createVoiceAccessToken();
      plugin.logger.log(
        'voice plugin: generated local access token for managed voice client.'
      );
      plugin.logger.log(
        'onAssistantWillAcceptRequests: Completed managed voice access token initialization.'
      );
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      plugin.logger.log(
        'onAssistantAcceptsRequests: Starting managed voice client startup.'
      );
      if (!runtimeState.accessToken) {
        throw new Error(
          'voice plugin could not launch the managed voice client because no access token was initialized.'
        );
      }

      const systemConfig = UserConfig.getConfig();
      const baseUrl = `http://${systemConfig.webInterface.bindToAddress}:${systemConfig.webInterface.port}`;

      startManagedVoiceClient({
        config: config.getPluginConfig(),
        token: runtimeState.accessToken,
        baseUrl,
        wakeWord: systemConfig.wakeWord,
        clientScriptPath: path.join(
          currentDir,
          'client',
          'alice-voice-client.py'
        ),
        state: runtimeState.managedClientState,
        logger: plugin.logger,
      });
      plugin.logger.log(
        'onAssistantAcceptsRequests: Completed managed voice client startup request.'
      );
    });

    plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
      plugin.logger.log(
        'onAssistantWillStopAcceptingRequests: Starting voice runtime shutdown.'
      );
      await closeVoiceRuntime();
      plugin.logger.log(
        'onAssistantWillStopAcceptingRequests: Completed voice runtime shutdown.'
      );
    });

    plugin.hooks.onPluginsWillUnload(async () => {
      plugin.logger.log(
        'onPluginsWillUnload: Starting final voice runtime shutdown.'
      );
      await closeVoiceRuntime();
      plugin.logger.log(
        'onPluginsWillUnload: Completed final voice runtime shutdown.'
      );
    });
  },
};

export default voicePlugin;
