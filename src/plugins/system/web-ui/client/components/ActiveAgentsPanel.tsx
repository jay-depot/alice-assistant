import type { ActiveSessionAgent } from '../types/index.js';
import { formatRelativeTime, normalizeCssToken } from '../utils.js';

interface ActiveAgentsPanelProps {
  activeAgents: ActiveSessionAgent[];
  agentMonologue: Map<string, string>;
}

export function ActiveAgentsPanel({
  activeAgents,
  agentMonologue,
}: ActiveAgentsPanelProps) {
  return (
    <section className="active-agents-panel" aria-label="Running agents">
      <div className="active-agents-panel__label">Running Agents</div>
      <div className="active-agents-panel__list">
        {activeAgents.map(agent => {
          const monologue = agentMonologue.get(agent.instanceId);
          return (
            <article
              key={agent.instanceId}
              className={`active-agents-panel__item agent--${normalizeCssToken(agent.agentName)}`}
            >
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
              {monologue ? (
                <div className="active-agents-panel__monologue">
                  {monologue}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
