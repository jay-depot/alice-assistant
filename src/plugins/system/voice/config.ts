import { Type } from 'typebox';

export const VoicePluginConfigSchema = Type.Object({
  launchManagedClient: Type.Boolean({
    description: 'Whether the voice plugin should launch and supervise a local external voice client process.',
  }),
  sessionIdleTimeoutMinutes: Type.Optional(Type.Number({
    description: 'How many minutes a voice conversation stays active between wake-word activations before it expires and a fresh conversation is started.',
  })),
  wakeWordDetectedSoundPath: Type.Optional(Type.String({
    description: 'Optional path to a local audio file to play when the wake word is detected and voice capture is about to begin.',
  })),
  audioCaptureClosedSoundPath: Type.Optional(Type.String({
    description: 'Optional path to a local audio file to play when audio capture has finished.',
  })),
  managedClientCommand: Type.String({
    description: 'The command used to launch the local managed voice client.',
  }),
  managedClientArgs: Type.Array(Type.String(), {
    description: 'Arguments passed to the managed voice client command.',
  }),
  logManagedClientOutput: Type.Boolean({
    description: 'Whether stdout and stderr from the managed voice client should be mirrored into the assistant logs.',
  }),
});

export type VoicePluginConfig = Type.Static<typeof VoicePluginConfigSchema>;

export const defaultVoicePluginConfig: VoicePluginConfig = {
  launchManagedClient: false,
  sessionIdleTimeoutMinutes: 10,
  wakeWordDetectedSoundPath: '',
  audioCaptureClosedSoundPath: '',
  managedClientCommand: '',
  managedClientArgs: [],
  logManagedClientOutput: true,
};