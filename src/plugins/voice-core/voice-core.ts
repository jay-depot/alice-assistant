import { AlicePlugin } from '../../lib.js';
// This plugin's job is to ensure that we have at least one plugin providing each of the 
// following components:
// - An audio source component
// - A wake-word detection component
// - A speech-to-text component
// - A text-to-speech component
// - An audio sink component
// Having all of those available, it then manages a basic listen loop lifecycle, and hands off 
// detected audio to the right places in the right order. Also manages the conversation state.

type AudioMetadata = {
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

declare module '../../lib.js' {
  export interface PluginCapabilities {
    'voice-core': {
      /**
       * Returns a function that plugins can call to send audio data to the voice core plugin 
       * for wake word detection.
       * The plugin should call the returned function with audio data and metadata whenever 
       * it has new audio data to process. The audio clips sent to this function should be 250ms 
       * long (within a reasonable margin of error) and can be sent as frequently as needed 
       * (e.g. every 250ms). The voice-core plugin will stich these together into overlapping 
       * time slices for wake word detection.
       * 
       * The recordCallback is a function called by voice-core to signal that the source should 
       * start recording a new audio stream for a conversation turn. During this time, you SHOULD 
       * NOT send any data to the returned function mentioned above as it will be ignored. Ideally, 
       * your plugin should handle some kind of silence detection, and should only return the 
       * audio buffer once the user has stopped speaking for a certain amount of time. If that's not 
       * possible, record a reasonable amount of audio (e.g. 10 seconds) and then return the buffer.
       * 
       * The voice-core plugin may call recordCallback multiple times in a single conversation.
       * 
       * When the voice conversation is over, voice-core will call the restartDetectionCallback 
       * to signal that it's ready to receive audio data for wake word detection again.
       */
      registerAudioSource: (
        id: string, 
        recordCallback: () => Promise<Buffer>, 
        restartDetectionCallback: () => void
      ) => (audio: Buffer, metadata: AudioMetadata) => void;
      registerWakeWordDetection: (detector: (audio: Buffer, metadata: AudioMetadata) => boolean) => void;
      registerSpeechToText: (stt: (audio: Buffer, metadata: AudioMetadata) => Promise<string>) => void;
      registerTextToSpeech: (tts: (text: string, metadata: AudioMetadata) => Promise<{audio: Buffer, metadata: AudioMetadata}>) => void;
      registerAudioSink: (sink: (audio: Buffer, metadata: AudioMetadata) => void) => void;
    }
  }
}

const voiceCorePlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'voice-core',
    name: 'Voice Core',
    description: 'Core plugin for voice features',
    version: 'LATEST',
    dependencies: [],
    system: true,
    required: false // For now. Enable this when the other components are ready.
  },

  registerPlugin: async (api) => {
    const plugin = await api.registerPlugin();
  },
};

export default voiceCorePlugin;
