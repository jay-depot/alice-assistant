import type { ActiveSessionAgent } from '../types/index.js';
import { formatRelativeTime } from '../utils.js';

interface ActiveAgentsPanelProps {
  activeAgents: ActiveSessionAgent[];
}

export function ActiveAgentsPanel({ activeAgents }: ActiveAgentsPanelProps) {
  return (
    <section className="active-agents-panel" aria-label="Running agents">
      <div className="active-agents-panel__label">Running Agents</div>
      <div className="active-agents-panel__list">
        {activeAgents.map(agent => (
          <article key={agent.instanceId} className="active-agents-panel__item">
            <div className="active-agents-panel__name">{agent.agentName}</div>
            <div className="active-agents-panel__meta">
              <span className="active-agents-panel__status">Running</span>
              <span>Started {formatRelativeTime(agent.startedAt)}</span>
              {agent.pendingMessageCount > 0 ? (
                <span>
                  {agent.pendingMessageCount} queued update
                  {agent.pendingMessageCount === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
