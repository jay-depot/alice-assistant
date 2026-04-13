import { ConversationTypeId } from '../../../../lib.js';
import { AliceAgent } from './AliceAgent.js';

type OnAgentHatchingCallback = () => void;
type OnAgentFreezingCallback = () => void;
type OnAgentThawingCallback = () => void;
type OnAgentPausedCallback = () => void;
type OnAgentSleepingCallback = () => void;
type OnAgentForkingToAssistantCallback = (
  assistantConversationType: ConversationTypeId
) => void;

type IndependentAgentStatus =
  | 'hatching'
  | 'running'
  | 'freezing'
  | 'frozen'
  | 'thawing'
  | 'erroring'
  | 'stuck'
  | 'paused'
  | 'sleeping'
  | 'forkingToAssistant';

export abstract class IndependentAgent extends AliceAgent {
  constructor(public conversationType: ConversationTypeId) {
    super(conversationType);
  }

  public abstract getStatus(): IndependentAgentStatus;
  public abstract onAgentHatching(callback: OnAgentHatchingCallback): void;
  public abstract onAgentFreezing(callback: OnAgentFreezingCallback): void;
  public abstract onAgentThawing(callback: OnAgentThawingCallback): void;
  public abstract onAgentPaused(callback: OnAgentPausedCallback): void;
  public abstract onAgentSleeping(callback: OnAgentSleepingCallback): void;
  public abstract onAgentForkingToAssistant(
    callback: OnAgentForkingToAssistantCallback
  ): void;
}
