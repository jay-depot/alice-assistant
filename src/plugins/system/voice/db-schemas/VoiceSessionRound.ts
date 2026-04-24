import { defineEntity, p } from '@mikro-orm/sqlite';
import { VoiceSession } from './VoiceSession.js';

export type VoiceSessionRoundRole = 'user' | 'assistant' | 'system';
export type VoiceSessionRoundMessageKind = 'voice' | 'chat' | 'tool_call';

const VoiceSessionRoundSchema = defineEntity({
  name: 'VoiceSessionRound',
  properties: {
    id: p.integer().primary(),
    voiceSession: () => p.manyToOne(VoiceSession).fieldName('rounds'),
    role: p.string(),
    messageKind: p.string().default('voice'),
    content: p.string(),
    timestamp: p.datetime(),
    toolCallData: p.json().nullable().default(null),
  },
});

export class VoiceSessionRound extends VoiceSessionRoundSchema.class {
  declare role: VoiceSessionRoundRole;
  declare messageKind: VoiceSessionRoundMessageKind;
  declare toolCallData: Record<string, unknown>[] | null;
}

VoiceSessionRoundSchema.setClass(VoiceSessionRound);
