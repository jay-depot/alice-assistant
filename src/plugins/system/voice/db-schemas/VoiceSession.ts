import { defineEntity, p, type Collection } from '@mikro-orm/sqlite';
import { VoiceSessionRound } from './VoiceSessionRound.js';

/**
 * Status values for a voice session.
 *
 * - `active`: Currently in use by the voice client.
 * - `set_aside`: Timed out or interrupted; context persisted for possible resume.
 * - `archiving`: Being summarized and archived (transient state).
 * - `archived`: Fully archived; context has been summarized and evicted from memory.
 */
export const VOICE_SESSION_STATUS_VALUES = [
  'active',
  'set_aside',
  'archiving',
  'archived',
] as const;

export type VoiceSessionStatus = (typeof VOICE_SESSION_STATUS_VALUES)[number];

const VoiceSessionSchema = defineEntity({
  name: 'VoiceSession',
  properties: {
    id: p.integer().primary(),
    status: p.string().default('active'),
    conversationType: p.string().default('voice'),
    title: p.string().default(''),
    /**
     * Serialized compacted conversation context (JSON array of {role, content} messages).
     * Persisted so that voice sessions can be restored with their compaction state intact
     * across wake-word activations and app restarts.
     */
    compactedContext: p.json().nullable().default(null),
    /**
     * Serialized raw conversation context (JSON array of {role, content} messages).
     * Persisted alongside compactedContext for full context restoration.
     */
    rawContext: p.json().nullable().default(null),
    /**
     * If this session belongs to a task assistant, the task assistant definition id.
     * Null for regular voice conversations.
     */
    taskAssistantId: p.string().nullable().default(null),
    /**
     * If this session belongs to a session-linked agent, the agent instance id.
     * Null for regular voice conversations.
     */
    agentInstanceId: p.string().nullable().default(null),
    /**
     * If this session is a sub-conversation (e.g. task assistant), the parent
     * voice session id that spawned it.
     */
    parentSessionId: p.integer().nullable().default(null),
    rounds: () =>
      p
        .oneToMany(VoiceSessionRound)
        .fieldName('voiceSession')
        .mappedBy('voiceSession')
        .orphanRemoval(true),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
    lastActivityAt: p.datetime(),
  },
});

export class VoiceSession extends VoiceSessionSchema.class {
  declare status: VoiceSessionStatus;
  declare conversationType: string;
  declare title: string;
  declare compactedContext: Record<string, unknown>[] | null;
  declare rawContext: Record<string, unknown>[] | null;
  declare taskAssistantId: string | null;
  declare agentInstanceId: string | null;
  declare parentSessionId: number | null;
  declare rounds: Collection<VoiceSessionRound>;
  declare createdAt: Date;
  declare updatedAt: Date;
  declare lastActivityAt: Date;
}

VoiceSessionSchema.setClass(VoiceSession);
