import { Type } from 'typebox';
import { AlicePlugin } from '../../lib.js';

const VoiceAudioSourceSoxPluginConfigSchema = Type.Object({
  device: Type.Optional(Type.String()), // Recording device to use.
  sampleRate: Type.Number({ minimum: 1 }),
  channels: Type.Number({ minimum: 1 }),
  bitDepth: Type.Number({ minimum: 8 }),
  detectionChunkMs: Type.Number({ minimum: 50 }),
  // TODO: Get rid of this and do some kind of silence detection instead.
  conversationRecordMs: Type.Number({ minimum: 250 }),
});

type VoiceAudioSourceSoxPluginConfig = Type.Static<typeof VoiceAudioSourceSoxPluginConfigSchema>;

const voiceAudioSourceSoxPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'voice-audio-source-sox',
    name: 'Voice Audio Source - SoX',
    description: 'Audio source plugin that uses SoX to capture audio from the microphone',
    version: 'LATEST',
    dependencies: [{ id: 'voice-core', version: 'LATEST' }],
    system: true,
    required: false
  },
  registerPlugin: async (api) => {
    const plugin = await api.registerPlugin();
    const voiceCore = plugin.request('voice-core');

    const { default: NodeSox } = await import('node-sox');
    const { getPluginConfig } = await plugin.config<VoiceAudioSourceSoxPluginConfig>(
      VoiceAudioSourceSoxPluginConfigSchema, {
        device: undefined,
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        detectionChunkMs: 250,
        conversationRecordMs: 10000,
      }
    );
    const config = getPluginConfig();
    const audioMetadata = {
      sampleRate: config.sampleRate,
      channels: config.channels,
      bitDepth: config.bitDepth,
    };
    const bytesPerDetectionChunk = Math.max(
      1,
      Math.floor(
        config.sampleRate *
          config.channels *
          (config.bitDepth / 8) *
          (config.detectionChunkMs / 1000)
      )
    );

    let sox: InstanceType<typeof NodeSox> | undefined;
    let detectionBuffer = Buffer.alloc(0);
    let detectionEnabled = true;
    let currentRecording:
      | {
          chunks: Buffer[];
          timeout: NodeJS.Timeout;
          resolve: (audio: Buffer) => void;
          reject: (error: Error) => void;
        }
      | undefined;

    const finishRecording = (error?: Error) => {
      if (!currentRecording) {
        return;
      }

      const recording = currentRecording;
      currentRecording = undefined;
      clearTimeout(recording.timeout);

      if (error) {
        recording.reject(error);
        return;
      }

      recording.resolve(Buffer.concat(recording.chunks));
    };

    const flushDetectionAudio = (sendAudio: (audio: Buffer, metadata: typeof audioMetadata) => void) => {
      while (detectionEnabled && detectionBuffer.length >= bytesPerDetectionChunk) {
        const chunk = Buffer.from(detectionBuffer.subarray(0, bytesPerDetectionChunk));
        detectionBuffer = detectionBuffer.subarray(bytesPerDetectionChunk);
        sendAudio(chunk, audioMetadata);
      }
    };

    const sendAudio = voiceCore.registerAudioSource(
      'sox',
      async () => {
        if (currentRecording) {
          throw new Error('voice-audio-source-sox was asked to start a new recording while one was already in progress.');
        }

        detectionEnabled = false;
        detectionBuffer = Buffer.alloc(0);

        return await new Promise<Buffer>((resolve, reject) => {
          const timeout = setTimeout(() => {
            finishRecording();
          }, config.conversationRecordMs);

          currentRecording = {
            chunks: [],
            timeout,
            resolve,
            reject,
          };
        });
      },
      () => {
        finishRecording();
        detectionBuffer = Buffer.alloc(0);
        detectionEnabled = true;
      }
    );

    const startSox = () => {
      if (sox) {
        return;
      }

      sox = new NodeSox({
        device: config.device ?? null,
        bits: config.bitDepth,
        channels: config.channels,
        encoding: 'signed-integer',
        rate: config.sampleRate,
        type: 'raw',
      });

      sox.on('data', (data) => {
        const chunk = Buffer.from(data);

        if (currentRecording) {
          currentRecording.chunks.push(chunk);
          return;
        }

        if (!detectionEnabled) {
          return;
        }

        detectionBuffer = Buffer.concat([detectionBuffer, chunk]);
        flushDetectionAudio(sendAudio);
      });

      sox.on('error', (error) => {
        finishRecording(error instanceof Error ? error : new Error(String(error)));
        console.error('[voice-audio-source-sox] SoX recorder error:', error);
      });

      sox.on('close', () => {
        sox = undefined;
      });

      sox.start();
    };

    const stopSox = () => {
      if (!sox) {
        return;
      }

      sox.stop();
      sox = undefined;
      finishRecording(new Error('voice-audio-source-sox stopped while a recording was in progress.'));
      detectionBuffer = Buffer.alloc(0);
    };

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      startSox();
    });

    plugin.hooks.onPluginsWillUnload(async () => {
      stopSox();
    });

  }
};

export default voiceAudioSourceSoxPlugin;
