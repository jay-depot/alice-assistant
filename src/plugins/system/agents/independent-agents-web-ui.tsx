import type { PluginClientExport } from '../web-ui/client/types/index.js';

type ReactModule = typeof import('react');

const React = (globalThis as typeof globalThis & { React?: ReactModule }).React;

if (!React) {
  throw new Error(
    'Independent Agents web UI extension requires globalThis.React to be available.'
  );
}

const { useCallback, useEffect, useState, createElement: h } = React;

type IndependentAgentRecord = {
  instanceId: string;
  agentId: string;
  agentName: string;
  description: string;
  conversationType: string;
  status:
    | 'hatching'
    | 'running'
    | 'sleeping'
    | 'paused'
    | 'freezing'
    | 'frozen'
    | 'thawing'
    | 'stuck'
    | 'forkingToChat'
    | 'erroring';
  statusMessage?: string;
  startedAt: string;
  updatedAt: string;
  lastActivityAt: string;
  lastStateChangeAt: string;
};

async function fetchIndependentAgents(): Promise<IndependentAgentRecord[]> {
  const response = await fetch('/api/agents/independent');
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(
      data.error || `Failed to fetch independent agents: ${response.statusText}`
    );
  }

  const data = await response.json();
  return Array.isArray(data.agents) ? data.agents : [];
}

async function postAgentAction(
  agentId: string,
  action: 'pause' | 'resume' | 'suspend'
): Promise<void> {
  const response = await fetch(
    `/api/agents/independent/${encodeURIComponent(agentId)}/${action}`,
    { method: 'POST' }
  );
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(
      data.error || `Action ${action} failed: ${response.statusText}`
    );
  }
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString();
}

function IndependentAgentsPage() {
  const [agents, setAgents] = useState<IndependentAgentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);

    try {
      const nextAgents = await fetchIndependentAgents();
      setAgents(nextAgents);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load independent agents.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return h(
    'div',
    { className: 'independent-agents-page' },
    h(
      'section',
      { className: 'independent-agents-page__screen' },
      h(
        'header',
        { className: 'independent-agents-page__hero' },
        h(
          'div',
          { className: 'independent-agents-page__eyebrow' },
          'SYSTEM MONITOR // INDEPENDENT AGENTS'
        ),
        h(
          'h2',
          { className: 'independent-agents-page__title' },
          'Independent Agents'
        ),
        h(
          'p',
          { className: 'independent-agents-page__description' },
          'Monitor and supervise background agents that are not attached to a specific chat session.'
        ),
        h(
          'div',
          { className: 'independent-agents-page__toolbar' },
          h(
            'div',
            { className: 'independent-agents-page__stat-strip' },
            h(
              'span',
              { className: 'independent-agents-page__stat-label' },
              'Running Instances'
            ),
            h(
              'span',
              { className: 'independent-agents-page__stat-value' },
              String(agents.length)
            )
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'independent-agents-page__refresh',
              onClick: () => {
                setLoading(true);
                void refresh();
              },
            },
            'Refresh Feed'
          )
        )
      ),
      h(
        'div',
        { className: 'independent-agents-page__terminal' },
        h(
          'div',
          { className: 'independent-agents-page__terminal-bar' },
          h('span', null, 'agent-monitor.log'),
          h('span', null, loading ? 'polling...' : 'stable link')
        ),
        loading
          ? h(
              'p',
              { className: 'independent-agents-page__loading' },
              'Loading active agent telemetry...'
            )
          : error
            ? h('div', { className: 'independent-agents-page__error' }, error)
            : agents.length === 0
              ? h(
                  'div',
                  { className: 'independent-agents-page__empty' },
                  h('p', null, 'No independent agents are currently running.'),
                  h(
                    'p',
                    null,
                    'Enable a plugin that registers an independent agent, then refresh this page.'
                  )
                )
              : h(
                  'div',
                  { className: 'independent-agents-page__list' },
                  ...agents.map(agent =>
                    h(
                      'article',
                      {
                        key: agent.instanceId,
                        className: 'independent-agents-page__card',
                      },
                      h(
                        'div',
                        { className: 'independent-agents-page__card-header' },
                        h(
                          'div',
                          {
                            className: 'independent-agents-page__card-heading',
                          },
                          h(
                            'div',
                            {
                              className: 'independent-agents-page__card-label',
                            },
                            agent.agentId
                          ),
                          h('h3', null, agent.agentName)
                        ),
                        h(
                          'span',
                          {
                            className:
                              'independent-agents-page__status independent-agents-page__status--' +
                              agent.status,
                          },
                          agent.status
                        )
                      ),
                      h(
                        'p',
                        { className: 'independent-agents-page__copy' },
                        agent.description
                      ),
                      agent.statusMessage
                        ? h(
                            'p',
                            { className: 'independent-agents-page__message' },
                            '> ',
                            agent.statusMessage
                          )
                        : null,
                      h(
                        'div',
                        { className: 'independent-agents-page__controls' },
                        agent.status === 'running' ||
                          agent.status === 'sleeping'
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className:
                                  'independent-agents-page__ctrl independent-agents-page__ctrl--pause',
                                onClick: () => {
                                  void postAgentAction(
                                    agent.agentId,
                                    'pause'
                                  ).then(refresh);
                                },
                              },
                              'Pause'
                            )
                          : null,
                        agent.status === 'paused'
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className:
                                  'independent-agents-page__ctrl independent-agents-page__ctrl--resume',
                                onClick: () => {
                                  void postAgentAction(
                                    agent.agentId,
                                    'resume'
                                  ).then(refresh);
                                },
                              },
                              'Resume'
                            )
                          : null,
                        agent.status === 'stuck'
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className:
                                  'independent-agents-page__ctrl independent-agents-page__ctrl--suspend',
                                onClick: () => {
                                  void postAgentAction(
                                    agent.agentId,
                                    'suspend'
                                  ).then(refresh);
                                },
                              },
                              'Suspend'
                            )
                          : null
                      ),
                      h(
                        'dl',
                        { className: 'independent-agents-page__meta' },
                        h('dt', null, 'Conversation Type'),
                        h('dd', null, agent.conversationType),
                        h('dt', null, 'Started'),
                        h('dd', null, formatTimestamp(agent.startedAt)),
                        h('dt', null, 'Last Activity'),
                        h('dd', null, formatTimestamp(agent.lastActivityAt)),
                        h('dt', null, 'Last State Change'),
                        h('dd', null, formatTimestamp(agent.lastStateChangeAt))
                      )
                    )
                  )
                )
      )
    )
  );
}

const IndependentAgentsWebUi: PluginClientExport = {
  routes: [
    {
      path: '/agents',
      title: 'Agents',
      component: IndependentAgentsPage,
    },
  ],
};

export default IndependentAgentsWebUi;
