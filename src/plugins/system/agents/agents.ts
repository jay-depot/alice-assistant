import path from 'node:path';
import type { AlicePlugin } from '../../../lib.js';
import { AgentSystem } from '../../../lib.js';
import { Type } from 'typebox';
import { AgentsCheckpoint } from './db-schemas/index.js';

/**
 * How long (ms) an independent agent can go without reporting activity before
 * being marked stuck. Default: 5 minutes.
 */
const STUCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * How often (ms) to check for stuck agents. Default: 1 minute.
 */
const STUCK_CHECK_INTERVAL_MS = 60 * 1000;

let stuckCheckTimer: ReturnType<typeof setInterval> | undefined;

const agentsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'agents',
    name: 'Agent Engine',
    brandColor: '#76ee4a',
    version: 'LATEST',
    builtInCategory: 'system',
    description:
      'Provides the session-linked agent runtime and the framework tools ' +
      '(agentReportProgress, agentReturnResult) that all session-linked agents use.',
    dependencies: [
      { id: 'web-ui', version: 'LATEST' },
      { id: 'memory', version: 'LATEST' },
    ],
  },

  registerPlugin: async api => {
    const plugin = await api.registerPlugin();

    // Register database model for agent checkpoints
    const memoryApi = plugin.request('memory');
    if (memoryApi) {
      memoryApi.registerDatabaseModels([AgentsCheckpoint]);
    }

    const awaitForOrm = memoryApi
      ? memoryApi.onDatabaseReady(async orm => orm)
      : Promise.resolve(undefined);

    plugin.registerTool({
      name: 'agentReportProgress',
      availableFor: [],
      description:
        'Report a progress update from within a session-linked agent. ' +
        'Call this after each significant milestone in your assigned task.',
      parameters: Type.Object({
        message: Type.String({
          description:
            'A concise progress update describing what was found or accomplished. ' +
            'One to three sentences.',
        }),
      }),
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (args, context) => {
        const typedArgs = args as { message: string };
        if (!context.agentInstanceId) {
          return 'No active agent instance found. Progress not recorded.';
        }
        await AgentSystem.reportProgress(
          context.agentInstanceId,
          typedArgs.message
        );
        return 'Progress update recorded.';
      },
    });

    plugin.registerTool({
      name: 'agentReturnResult',
      availableFor: [],
      description:
        'Return the final result from a session-linked agent. ' +
        'Call this when you have completed all of your assigned tasks. ' +
        'This ends the agent session.',
      parameters: Type.Object({
        summary: Type.String({
          description:
            'A one to two sentence summary of your assigned tasks and their outcomes.',
        }),
        report: Type.String({
          description:
            'The full report in markdown format. ' +
            'Include sections: Task Definitions, Task Execution, and Outcomes.',
        }),
      }),
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (args, context) => {
        const typedArgs = args as { summary: string; report: string };
        if (!context.agentInstanceId) {
          return 'No active agent instance found. Result not recorded.';
        }
        await AgentSystem.returnResult(context.agentInstanceId, {
          summary: typedArgs.summary,
          report: typedArgs.report,
        });
        return 'Result recorded. Agent session complete.';
      },
    });

    plugin.registerTool({
      name: 'agentSleep',
      availableFor: [],
      description:
        'Signal that the independent agent has no more work to do and should ' +
        'go to sleep. The agent will be woken when new work arrives. ' +
        'Call this when you have completed your current task or determined ' +
        'that there is nothing more to do right now.',
      parameters: Type.Object({
        reason: Type.String({
          description:
            'A brief reason for going to sleep, e.g. "Daily review complete." ' +
            'or "No new conversations to analyze."',
        }),
      }),
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      execute: async (args, context) => {
        const typedArgs = args as { reason: string };
        if (!context.agentInstanceId) {
          return 'No active agent instance found. Sleep not recorded.';
        }
        const agentId = AgentSystem.getIndependentAgentIdByInstanceId(
          context.agentInstanceId
        );
        if (!agentId) {
          return 'No active agent found for this instance. Sleep not recorded.';
        }
        await AgentSystem.sleepIndependentAgent(agentId, typedArgs.reason);
        return 'You are now sleeping. You will be woken when new work arrives.';
      },
    });

    plugin.registerTool({
      name: 'getAllIndependentAgentStatuses',
      availableFor: ['chat', 'voice'],
      description:
        'Call getAllIndependentAgentStatuses to get the current status of all ' +
        'active independent agents when needed to answer a user question or request.',
      parameters: Type.Object({}),
      systemPromptFragment: '',
      toolResultPromptIntro: '',
      toolResultPromptOutro: '',
      taintStatus: 'clean',
      requiresApproval: false,
      execute: async () => {
        const statuses = AgentSystem.getIndependentInstances();
        return JSON.stringify(statuses);
      },
    });

    plugin.hooks.onUserConversationWillEnd(async conversation => {
      if (conversation.sessionId) {
        AgentSystem.cancelBySession(conversation.sessionId);
      }
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      const webUi = plugin.request('web-ui');
      if (!webUi) {
        throw new Error(
          'agents plugin could not access the web-ui plugin capabilities. Disable agents or fix web-ui to continue.'
        );
      }

      const app = webUi.express;

      app.get('/api/agents/independent', async (_req, res) => {
        try {
          const agents = AgentSystem.getIndependentInstances().map(
            instance => ({
              instanceId: instance.instanceId,
              agentId: instance.agentId,
              agentName: instance.agentName,
              description: instance.description,
              conversationType: instance.conversationType,
              status: instance.status,
              statusMessage: instance.statusMessage,
              startedAt: instance.startedAt.toISOString(),
              updatedAt: instance.updatedAt.toISOString(),
              lastActivityAt: instance.lastActivityAt.toISOString(),
              lastStateChangeAt: instance.lastStateChangeAt.toISOString(),
            })
          );

          res.json({ agents });
        } catch (error) {
          res.status(500).json({
            error: `Failed to list independent agents: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });

      app.post('/api/agents/independent/:agentId/pause', async (req, res) => {
        try {
          const { agentId } = req.params;
          if (typeof agentId !== 'string') {
            res.status(400).json({ error: 'agentId is required.' });
            return;
          }

          await AgentSystem.pauseIndependentAgent(agentId);
          const instance = AgentSystem.getIndependentInstance(agentId);

          if (!instance) {
            res.status(404).json({ error: `Agent ${agentId} not found.` });
            return;
          }

          res.json({
            agentId: instance.agentId,
            status: instance.status,
            statusMessage: instance.statusMessage,
          });
        } catch (error) {
          res.status(500).json({
            error: `Failed to pause agent: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });

      app.post('/api/agents/independent/:agentId/resume', async (req, res) => {
        try {
          const { agentId } = req.params;
          if (typeof agentId !== 'string') {
            res.status(400).json({ error: 'agentId is required.' });
            return;
          }

          await AgentSystem.resumeIndependentAgent(agentId);
          const instance = AgentSystem.getIndependentInstance(agentId);

          if (!instance) {
            res.status(404).json({ error: `Agent ${agentId} not found.` });
            return;
          }

          res.json({
            agentId: instance.agentId,
            status: instance.status,
            statusMessage: instance.statusMessage,
          });
        } catch (error) {
          res.status(500).json({
            error: `Failed to resume agent: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });

      app.post('/api/agents/independent/:agentId/suspend', async (req, res) => {
        try {
          const { agentId } = req.params;
          if (typeof agentId !== 'string') {
            res.status(400).json({ error: 'agentId is required.' });
            return;
          }

          await AgentSystem.suspendIndependentAgent(agentId);
          const instance = AgentSystem.getIndependentInstance(agentId);

          if (!instance) {
            res.status(404).json({ error: `Agent ${agentId} not found.` });
            return;
          }

          res.json({
            agentId: instance.agentId,
            status: instance.status,
            statusMessage: instance.statusMessage,
          });
        } catch (error) {
          res.status(500).json({
            error: `Failed to suspend agent: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });

      const currentDir = import.meta.dirname;
      webUi.registerScript(
        path.join(currentDir, 'independent-agents-web-ui.js')
      );
      webUi.registerStylesheet(
        path.join(currentDir, 'independent-agents-web-ui.css')
      );

      // Start stuck detection timer
      stuckCheckTimer = setInterval(() => {
        const now = Date.now();
        for (const instance of AgentSystem.getIndependentInstances()) {
          if (
            instance.status === 'running' &&
            now - instance.lastActivityAt.getTime() > STUCK_TIMEOUT_MS
          ) {
            AgentSystem.markIndependentAgentStuck(
              instance.agentId,
              `No activity for ${Math.round((now - instance.lastActivityAt.getTime()) / 1000)}s. Agent may be stuck.`
            );
          }
        }
      }, STUCK_CHECK_INTERVAL_MS);

      // Thaw any persisted agent checkpoints from previous session
      const orm = await awaitForOrm;
      if (orm) {
        try {
          const em = orm.em.fork();
          const checkpoints = await em.find(AgentsCheckpoint, {});
          if (checkpoints.length > 0) {
            plugin.logger.log(
              `[agents] Thawing ${checkpoints.length} persisted agent checkpoint(s)...`
            );
            for (const checkpoint of checkpoints) {
              try {
                // Use restoreIndependentAgent to create the instance without
                // calling start(), then thaw to restore state. This avoids
                // re-running the agent's full start() loop on every restart.
                AgentSystem.restoreIndependentAgent(checkpoint.agentId);
                if (checkpoint.frozenState) {
                  await AgentSystem.thawIndependentAgent(
                    checkpoint.agentId,
                    checkpoint.frozenState
                  );
                } else {
                  // No frozen state — start normally as a fresh agent
                  await AgentSystem.startIndependentAgent(checkpoint.agentId);
                }
              } catch (error) {
                plugin.logger.log(
                  `[agents] Failed to thaw agent ${checkpoint.agentId}: ${error instanceof Error ? error.message : String(error)}`
                );
              }
            }
            // Clean up checkpoints after successful thaw
            await em.remove(checkpoints);
            await em.flush();
            plugin.logger.log(`[agents] ...agent checkpoint thaw complete.`);
          }
        } catch (error) {
          plugin.logger.log(
            `[agents] Error during agent thaw: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    });

    plugin.hooks.onAssistantWillStopAcceptingRequests(async () => {
      plugin.logger.log(
        '[agents] onAssistantWillStopAcceptingRequests: Stopping stuck detection and freezing agents...'
      );

      if (stuckCheckTimer) {
        clearInterval(stuckCheckTimer);
        stuckCheckTimer = undefined;
      }

      // Freeze all active independent agents and persist checkpoints
      const orm = await awaitForOrm;
      if (orm) {
        try {
          const frozenStates = await AgentSystem.freezeAllIndependentAgents();
          const em = orm.em.fork();

          // Clear existing checkpoints
          const existing = await em.find(AgentsCheckpoint, {});
          if (existing.length > 0) {
            await em.remove(existing);
          }

          // Write new checkpoints
          for (const [agentId, frozenState] of frozenStates) {
            const instance = AgentSystem.getIndependentInstance(agentId);
            if (!instance) {
              continue;
            }

            const pluginId =
              AgentSystem.getIndependentDefinitionPluginId(agentId) ??
              'unknown';

            const checkpoint = em.create(AgentsCheckpoint, {
              agentId,
              pluginId,
              agentName: instance.agentName,
              description: instance.description,
              conversationType: instance.conversationType,
              status: instance.status,
              statusMessage: instance.statusMessage ?? null,
              frozenState: frozenState ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            em.persist(checkpoint);
          }

          await em.flush();
          plugin.logger.log(
            `[agents] ...frozen ${frozenStates.size} agent(s) to database.`
          );
        } catch (error) {
          plugin.logger.log(
            `[agents] Error during agent freeze: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      plugin.logger.log(
        '[agents] onAssistantWillStopAcceptingRequests: ...agent freeze complete.'
      );
    });
  },
};

export default agentsPlugin;
