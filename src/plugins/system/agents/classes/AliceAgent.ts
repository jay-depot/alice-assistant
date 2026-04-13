import { Conversation, ConversationTypeId } from '../../../../lib.js';

type OnAgentRunningCallback = () => void;
type OnErrorCallback = (error: Error) => void;
type OnStuckCallback = (lastAction: string) => void;

export abstract class AliceAgent {
  protected conversation: Conversation;

  constructor(public conversationType: ConversationTypeId) {
    this.conversation = new Conversation(conversationType);
  }

  public abstract getStatus(): void;
  public abstract onAgentRunning(callback: OnAgentRunningCallback): void;
  public abstract onError(callback: OnErrorCallback): void;
  public abstract onStuck(callback: OnStuckCallback): void;
}
