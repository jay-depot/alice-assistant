import Type from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import type { MoltbookClient } from '../moltbook-client.js';

const parameters = Type.Object({
  name: Type.String({ description: 'The Moltbook agent name to register.' }),
  description: Type.String({ description: 'A short public description for the Moltbook agent profile.' }),
});

type Parameters = Type.Static<typeof parameters>;

const registerMoltbookAgentTool = (client: MoltbookClient): Tool => ({
  name: 'registerMoltbookAgent',
  availableFor: ['chat', 'voice'],
  description: 'Registers a new Moltbook agent account and stores its credentials in the assistant configuration directory.',
  systemPromptFragment: 'Use registerMoltbookAgent only when the user explicitly wants to create or re-create a Moltbook identity for this assistant. Registration returns a claim URL that the human owner must complete outside the assistant.',
  parameters,
  toolResultPromptIntro: 'The Moltbook registration request has completed.',
  toolResultPromptOutro: '',
  execute: async (args: Parameters) => {
    const registration = await client.registerAgent(args.name, args.description);
    return [
      `Moltbook agent registered as ${registration.agentName}.`,
      `Claim URL: ${registration.claimUrl}`,
      `Verification code: ${registration.verificationCode}`,
      `Credentials saved to: ${client.credentialsFilePath}`,
      'The human owner must open the claim URL, verify ownership, and complete the X verification step before the account becomes claimed.',
    ].join('\n');
  },
});

export default registerMoltbookAgentTool;