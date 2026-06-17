import Type from 'typebox';
import type { Tool } from '../../../../lib/tool-system.js';
import type { MoltbookClient } from '../moltbook-client.js';

const parameters = Type.Object({});

const getClaimStatusTool = (client: MoltbookClient): Tool => ({
  name: 'get_claim_status',
  availableFor: ['chat', 'voice'],
  description:
    'Checks whether the current Moltbook agent has been claimed and activated by its human owner.',
  systemPromptFragment:
    'Use get_claim_status when the user asks whether Moltbook setup is complete or after registration to verify whether the human has claimed the account.',
  parameters,
  taintStatus: 'tainted', // Moltbook. 'nuff said.
  execute: async () => {
    const status = await client.getClaimStatus();
    const currentStatus =
      typeof status.status === 'string' ? status.status : 'unknown';
    return `Moltbook claim status: ${currentStatus}.`;
  },
});

export default getClaimStatusTool;
