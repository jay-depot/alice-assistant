import { Type } from 'typebox';

export const VoicePluginConfigSchema = Type.Object({
  launchManagedClient: Type.Boolean({
    description:
      'Whether the voice plugin should launch and supervise a local external voice client process.',
  }),
  sessionIdleTimeoutMinutes: Type.Optional(
    Type.Number({
      description:
        'How many minutes a voice conversation stays active between wake-word activations before it expires and a fresh conversation is started.',
    })
  ),
  deferredSessionCloseDelayMs: Type.Optional(
    Type.Number({
      description:
        'How long to wait before finalizing an expired voice conversation in the background after a fresh one starts.',
    })
  ),
  wakeWordDetectedSoundPath: Type.Optional(
    Type.String({
      description:
        'Optional path to a local audio file to play when the wake word is detected and voice capture is about to begin.',
    })
  ),
  audioCaptureClosedSoundPath: Type.Optional(
    Type.String({
      description:
        'Optional path to a local audio file to play when audio capture has finished.',
    })
  ),
  continuationSilencePrompt: Type.Optional(
    Type.String({
      description:
        'Spoken line to say when the user stays silent during the immediate follow-up listening turn and the conversation is being closed.',
    })
  ),
  archivingStartedPrompt: Type.Optional(
    Type.String({
      description:
        'Spoken line to say when a voice conversation starts archiving after it is closed.',
    })
  ),
  archivingCompletedPrompt: Type.Optional(
    Type.String({
      description:
        'Spoken line to say when voice conversation archival has finished.',
    })
  ),
  minCaptureSeconds: Type.Optional(
    Type.Number({
      description:
        'Minimum amount of time to keep recording after capture begins before trailing silence can end the turn.',
    })
  ),
  maxCaptureSeconds: Type.Optional(
    Type.Number({
      description:
        'Hard maximum recording length for a single captured voice turn.',
    })
  ),
  trailingSilenceMs: Type.Optional(
    Type.Number({
      description:
        'How much consecutive low-energy audio after speech should end the current capture.',
    })
  ),
  speechThreshold: Type.Optional(
    Type.Number({
      description:
        'Normalized RMS threshold used to decide whether an audio chunk counts as speech for first-pass silence detection.',
    })
  ),
  backgroundNoiseSampleSeconds: Type.Optional(
    Type.Number({
      description:
        'How long to sample ambient room noise after wake-word detection and before the listening sound plays.',
    })
  ),
  prerollMs: Type.Optional(
    Type.Number({
      description:
        'How much recent audio to retain before speech starts so the beginning of an utterance is not clipped.',
    })
  ),
  managedClientCommand: Type.String({
    description: 'The command used to launch the local managed voice client.',
  }),
  managedClientArgs: Type.Array(Type.String(), {
    description: 'Arguments passed to the managed voice client command.',
  }),
  logManagedClientOutput: Type.Boolean({
    description:
      'Whether stdout and stderr from the managed voice client should be mirrored into the assistant logs.',
  }),
});

export type VoicePluginConfig = Type.Static<typeof VoicePluginConfigSchema>;

export const defaultVoicePluginConfig: VoicePluginConfig = {
  launchManagedClient: false,
  sessionIdleTimeoutMinutes: 10,
  deferredSessionCloseDelayMs: 0,
  wakeWordDetectedSoundPath: '',
  audioCaptureClosedSoundPath: '',
  continuationSilencePrompt: 'All right, I will close that conversation now.',
  archivingStartedPrompt: 'Archiving that now, one moment.',
  archivingCompletedPrompt: 'Finished archiving, ready for another request.',
  minCaptureSeconds: 1.25,
  maxCaptureSeconds: 7,
  trailingSilenceMs: 900,
  speechThreshold: 0.015,
  backgroundNoiseSampleSeconds: 0.75,
  prerollMs: 250,
  managedClientCommand: '',
  managedClientArgs: [],
  logManagedClientOutput: true,
};
