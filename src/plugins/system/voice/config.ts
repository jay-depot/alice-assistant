import { Type } from 'typebox';

export const VoicePluginConfigSchema = Type.Object({
  launchManagedClient: Type.Boolean({
    description: 'Whether the voice plugin should launch and supervise a local external voice client process.',
  }),
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
  managedClientCommand: '',
  managedClientArgs: [],
  logManagedClientOutput: true,
};