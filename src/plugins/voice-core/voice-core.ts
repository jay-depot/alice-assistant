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

declare module '../../lib.js' {
  export interface PluginCapabilities {
    // Short term, these are going to work with temp files.
    registerAudioSource: (id: string) => (audio: Buffer) => void;
    registerWakeWordDetection: (detector: (audio: Buffer) => boolean) => void;
    registerSpeechToText: (stt: (audio: Buffer) => Promise<string>) => void;
    registerTextToSpeech: (tts: (text: string) => Promise<Buffer>) => void;
    registerAudioSink: (sink: (audio: Buffer) => void) => void;
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
