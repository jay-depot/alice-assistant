import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AlicePlugin } from '../../../lib.js';
import type { IndependentAgentControl } from '../../../lib/agent-system.js';
import { simpleExpandTilde } from '../../../lib/simple-tilde-expansion.js';

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'system-sentinel': Record<string, never>;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute between health checks
const REPORT_DIR = '~/.alice-assistant/scratch/sentinel-reports';
const MAX_REPORTS = 10;

// ---------------------------------------------------------------------------
// Health check logic
// ---------------------------------------------------------------------------

type HealthCheck = {
  timestamp: string;
  cpuLoad: number[];
  memoryPercent: number;
  uptimeSeconds: number;
  freeMemoryMB: number;
  totalMemoryMB: number;
  notes: string[];
};

function collectHealthCheck(): HealthCheck {
  const loadAvg = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPercent = ((totalMem - freeMem) / totalMem) * 100;

  const notes: string[] = [];
  if (usedPercent > 90) {
    notes.push('Memory usage above 90% — consider closing applications.');
  }
  if (loadAvg[0] > os.cpus().length * 2) {
    notes.push('CPU load average is high relative to core count.');
  }

  return {
    timestamp: new Date().toISOString(),
    cpuLoad: [loadAvg[0], loadAvg[1], loadAvg[2]],
    memoryPercent: Math.round(usedPercent * 100) / 100,
    uptimeSeconds: Math.round(os.uptime()),
    freeMemoryMB: Math.round(freeMem / 1024 / 1024),
    totalMemoryMB: Math.round(totalMem / 1024 / 1024),
    notes,
  };
}

function formatReport(check: HealthCheck, checkNumber: number): string {
  const lines = [
    `# Sentinel Health Report #${checkNumber}`,
    '',
    `**Timestamp:** ${check.timestamp}`,
    `**Uptime:** ${Math.floor(check.uptimeSeconds / 3600)}h ${Math.floor((check.uptimeSeconds % 3600) / 60)}m`,
    `**CPU Load (1/5/15m):** ${check.cpuLoad.map(l => l.toFixed(2)).join(' / ')}`,
    `**Memory:** ${check.memoryPercent}% used (${check.freeMemoryMB}MB free of ${check.totalMemoryMB}MB)`,
  ];

  if (check.notes.length > 0) {
    lines.push('');
    lines.push('**Notes:**');
    for (const note of check.notes) {
      lines.push(`- ${note}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

async function writeReport(report: string, filename: string): Promise<void> {
  const reportDir = simpleExpandTilde(REPORT_DIR);
  const filePath = path.join(reportDir, filename);

  try {
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(filePath, report, 'utf-8');

    // Prune old reports
    const files = await fs.readdir(reportDir);
    if (files.length > MAX_REPORTS) {
      const sorted = files.sort();
      const toDelete = sorted.slice(0, files.length - MAX_REPORTS);
      await Promise.all(toDelete.map(f => fs.unlink(path.join(reportDir, f))));
    }
  } catch {
    // Intentionally swallowed — the sentinel should not crash on write failures
  }
}

// ---------------------------------------------------------------------------
// Sentinel state (for freeze/thaw)
// ---------------------------------------------------------------------------

type SentinelState = {
  checkCount: number;
  lastCheckTimestamp: string | null;
  findings: string[];
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const systemSentinelPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'system-sentinel',
    name: 'System Sentinel',
    brandColor: '#4a9e4a',
    version: 'LATEST',
    builtInCategory: 'community',
    description:
      'An independent agent that periodically checks system health, ' +
      'writes reports to scratch files, and exercises the full independent ' +
      'agent lifecycle (pause, resume, freeze, thaw, suspend).',
    dependencies: [{ id: 'agents', version: 'LATEST' }],
  },

  registerPlugin: async api => {
    const plugin = await api.registerPlugin();

    let checkTimer: ReturnType<typeof setInterval> | undefined;
    let agentControl: IndependentAgentControl | undefined;
    let sentinelState: SentinelState = {
      checkCount: 0,
      lastCheckTimestamp: null,
      findings: [],
    };

    // -----------------------------------------------------------------------
    // Timer management helpers
    // -----------------------------------------------------------------------

    function stopCheckLoop(): void {
      if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = undefined;
      }
    }

    function startCheckLoop(): void {
      stopCheckLoop();
      checkTimer = setInterval(performCheck, CHECK_INTERVAL_MS);
    }

    // -----------------------------------------------------------------------
    // Core check logic (single implementation, used everywhere)
    // -----------------------------------------------------------------------

    function performCheck(): void {
      if (!agentControl) return;
      const instance = agentControl.getInstance();
      // Skip if agent is in a state where checks shouldn't run
      if (
        instance.status === 'paused' ||
        instance.status === 'freezing' ||
        instance.status === 'frozen'
      ) {
        return;
      }

      try {
        const check = collectHealthCheck();
        sentinelState.checkCount++;
        sentinelState.lastCheckTimestamp = check.timestamp;

        for (const note of check.notes) {
          sentinelState.findings.push(`[${check.timestamp}] ${note}`);
          if (sentinelState.findings.length > 20) {
            sentinelState.findings.shift();
          }
        }

        agentControl.reportActivity();

        const report = formatReport(check, sentinelState.checkCount);
        const filename = `sentinel-${check.timestamp.replace(/[:.]/g, '-').slice(0, 19)}.md`;
        void writeReport(report, filename);

        agentControl.markRunning(
          `Check #${sentinelState.checkCount}: ${check.memoryPercent}% memory, load ${check.cpuLoad[0].toFixed(2)}`
        );
      } catch (err) {
        plugin.logger.log(
          `[system-sentinel] Error during health check: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // -----------------------------------------------------------------------
    // Independent agent registration
    // -----------------------------------------------------------------------

    const independentAgent = plugin.registerIndependentAgent({
      id: 'system-sentinel',
      name: 'System Sentinel',
      description:
        'Periodically checks system health (CPU, memory, uptime) and writes ' +
        'reports to scratch files. Exercises the full independent agent lifecycle.',
      conversationType: 'autonomy',

      start: async (control: IndependentAgentControl) => {
        plugin.logger.log('[system-sentinel] start: Sentinel is hatching...');
        agentControl = control;

        // Run an initial check immediately
        const initialCheck = collectHealthCheck();
        sentinelState.checkCount++;
        sentinelState.lastCheckTimestamp = initialCheck.timestamp;
        control.reportActivity();

        const report = formatReport(initialCheck, sentinelState.checkCount);
        const filename = `sentinel-${initialCheck.timestamp.replace(/[:.]/g, '-').slice(0, 19)}.md`;
        await writeReport(report, filename);

        control.markRunning(
          `Initial check #${sentinelState.checkCount}: ${initialCheck.memoryPercent}% memory, load ${initialCheck.cpuLoad[0].toFixed(2)}`
        );
        plugin.logger.log(
          `[system-sentinel] start: Initial check complete. Memory: ${initialCheck.memoryPercent}%, Load: ${initialCheck.cpuLoad[0].toFixed(2)}`
        );

        // Start the periodic check loop
        startCheckLoop();
        plugin.logger.log('[system-sentinel] start: Sentinel is now running.');
      },

      stop: async () => {
        plugin.logger.log(
          '[system-sentinel] stop: Sentinel is shutting down...'
        );
        stopCheckLoop();
        agentControl?.markSleeping('Sentinel is shutting down.');
        plugin.logger.log('[system-sentinel] stop: Sentinel stopped.');
      },

      onPause: async () => {
        plugin.logger.log('[system-sentinel] onPause: Stopping check loop...');
        stopCheckLoop();
        plugin.logger.log(
          '[system-sentinel] onPause: Check loop stopped. Sentinel is paused.'
        );
      },

      onResume: async (control: IndependentAgentControl) => {
        plugin.logger.log(
          '[system-sentinel] onResume: Restarting check loop...'
        );
        agentControl = control;
        startCheckLoop();
        control.markRunning(
          `Sentinel resumed. Continuing from check #${sentinelState.checkCount}.`
        );
        plugin.logger.log(
          '[system-sentinel] onResume: Sentinel is running again.'
        );
      },

      freeze: async () => {
        plugin.logger.log('[system-sentinel] freeze: Saving sentinel state...');
        stopCheckLoop();
        plugin.logger.log(
          `[system-sentinel] freeze: State snapshot — ${sentinelState.checkCount} checks performed.`
        );
        return {
          checkCount: sentinelState.checkCount,
          lastCheckTimestamp: sentinelState.lastCheckTimestamp,
          findings: sentinelState.findings,
        } satisfies SentinelState;
      },

      thaw: async (
        frozenState: Record<string, unknown>,
        control: IndependentAgentControl
      ) => {
        plugin.logger.log(
          '[system-sentinel] thaw: Restoring sentinel state...'
        );
        agentControl = control;
        sentinelState = {
          checkCount: (frozenState.checkCount as number) ?? 0,
          lastCheckTimestamp:
            (frozenState.lastCheckTimestamp as string) ?? null,
          findings: (frozenState.findings as string[]) ?? [],
        };
        plugin.logger.log(
          `[system-sentinel] thaw: Restored state — ${sentinelState.checkCount} prior checks.`
        );

        startCheckLoop();
        control.markRunning(
          `Sentinel restored. Resuming from check #${sentinelState.checkCount}.`
        );
        plugin.logger.log('[system-sentinel] thaw: Sentinel is now running.');
      },

      onSuspend: async () => {
        plugin.logger.log(
          '[system-sentinel] onSuspend: Stopping check loop for suspension...'
        );
        stopCheckLoop();
        plugin.logger.log(
          '[system-sentinel] onSuspend: Check loop stopped. Sentinel is suspended.'
        );
      },
    });

    plugin.hooks.onAssistantAcceptsRequests(async () => {
      plugin.logger.log(
        '[system-sentinel] onAssistantAcceptsRequests: Starting sentinel...'
      );
      await independentAgent.start();
      plugin.logger.log(
        '[system-sentinel] onAssistantAcceptsRequests: Sentinel started.'
      );
    });

    plugin.hooks.onPluginsWillUnload(async () => {
      plugin.logger.log(
        '[system-sentinel] onPluginsWillUnload: Stopping sentinel...'
      );
      stopCheckLoop();
      await independentAgent.stop();
      plugin.logger.log(
        '[system-sentinel] onPluginsWillUnload: Sentinel stopped.'
      );
    });
  },
};

export default systemSentinelPlugin;
