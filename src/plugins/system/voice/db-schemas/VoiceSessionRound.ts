import { defineEntity, p } from '@mikro-orm/sqlite';
import { VoiceSession } from './VoiceSession.js';

const VoiceSessionRoundSchema = defineEntity({
  name: 'VoiceSessionRound',
  properties: {
    id: p.integer().primary(),
    voiceSession: () => p.manyToOne(VoiceSession).fieldName('rounds'),
    role: p.enum(['user', 'assistant', 'system']),
    messageKind: p.enum(['voice', 'chat', 'tool_call']).default('voice'),
    content: p.string(),
    timestamp: p.datetime(),
    toolCallData: p.json().nullable().default(null),
  },
});

export class VoiceSessionRound extends VoiceSessionRoundSchema.class {}

VoiceSessionRoundSchema.setClass(VoiceSessionRound);
