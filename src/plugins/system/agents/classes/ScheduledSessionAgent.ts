import { ConversationTypeId } from '../../../../lib.js';
import { AliceAgent } from './AliceAgent.js';

type ScheduledSessionAgentStatus =
  | 'armed'
  | 'running'
  | 'handoffPending'
  | 'cancelled'
  | 'erroring'
  | 'stuck'
  | 'completed';

type OnAgentHandoffCallback = (toConversationType: ConversationTypeId) => void;

export abstract class ScheduledSessionAgent extends AliceAgent {
  constructor(public conversationType: ConversationTypeId) {
    super(conversationType);
  }

  public abstract getStatus(): ScheduledSessionAgentStatus;
  public abstract cancelAgent(): Promise<void>;
  public abstract onAgentHandoff(callback: OnAgentHandoffCallback): void;
  public abstract onAgentCancelled(callback: () => void): void;
  public abstract onAgentCompleted(callback: () => void): void;
}
