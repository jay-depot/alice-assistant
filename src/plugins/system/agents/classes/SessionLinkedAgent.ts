import { ConversationTypeId } from '../../../../lib.js';
import { AliceAgent } from './AliceAgent.js';

type SessionLinkedAgentStatus =
  | 'running'
  | 'needsInput'
  | 'cancelled'
  | 'erroring'
  | 'stuck'
  | 'completed';

export abstract class SessionLinkedAgent extends AliceAgent {
  constructor(
    public conversationType: ConversationTypeId,
    public linkedSessionId: string
  ) {
    super(conversationType);
  }

  public abstract getStatus(): SessionLinkedAgentStatus;
  public abstract cancelAgent(): Promise<void>;
  public abstract onAgentNeedsInput(callback: () => void): void;
  public abstract onAgentCancelled(callback: () => void): void;
  public abstract onAgentCompleted(callback: () => void): void;
}
