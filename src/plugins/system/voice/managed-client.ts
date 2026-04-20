import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { VoicePluginConfig } from './config.js';
import type { PluginLogger } from '../../../lib/plugin-logger.js';

export type ManagedVoiceClientState = {
  childProcess: ChildProcess | null;
};

export function createManagedVoiceClientState(): ManagedVoiceClientState {
  return {
    childProcess: null,
  };
}

export function isManagedVoiceClientRunning(
  state: ManagedVoiceClientState
): boolean {
  return !!state.childProcess && !state.childProcess.killed;
}

export function startManagedVoiceClient(options: {
  config: VoicePluginConfig;
  token: string;
  baseUrl: string;
  wakeWord: string;
  clientScriptPath: string;
  state: ManagedVoiceClientState;
  logger: PluginLogger;
}): void {
  const { config, token, baseUrl, wakeWord, clientScriptPath, state, logger } =
    options;

  if (!config.launchManagedClient) {
    logger.log('voice plugin: managed client launch disabled by config.');
    return;
  }

  if (state.childProcess && !state.childProcess.killed) {
    logger.log(
      'voice plugin: managed client already running, skipping duplicate launch.'
    );
    return;
  }

  if (!fs.existsSync(clientScriptPath)) {
    throw new Error(
      `voice plugin could not find bundled client script at ${clientScriptPath}. Rebuild the project and try again.`
    );
  }

  const command = config.managedClientCommand.trim() || 'python3';
  const commandBasename = path.basename(command).toLowerCase();
  const looksLikePython =
    commandBasename.includes('python') || commandBasename.includes('pypy');
  const args = looksLikePython
    ? ['-u', clientScriptPath, ...config.managedClientArgs]
    : config.managedClientCommand.trim()
      ? [clientScriptPath, ...config.managedClientArgs]
      : ['-u', clientScriptPath, ...config.managedClientArgs];

  const child = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      ALICE_VOICE_BASE_URL: baseUrl,
      ALICE_VOICE_TOKEN: token,
      ALICE_VOICE_WAKE_WORD: wakeWord,
    },
  });

  if (config.logManagedClientOutput) {
    child.stdout.on('data', chunk => {
      logger.log(`[voice-client stdout] ${String(chunk)}`);
    });
    child.stderr.on('data', chunk => {
      logger.warn(`[voice-client stderr] ${String(chunk)}`);
    });
  }

  child.on('exit', (code, signal) => {
    state.childProcess = null;
    logger.log(
      `voice plugin: managed client exited with code ${code ?? 'null'} signal ${signal ?? 'null'}.`
    );
  });

  child.on('error', error => {
    state.childProcess = null;
    logger.error('voice plugin: managed client failed to start:', error);
  });

  state.childProcess = child;
  logger.log(
    `voice plugin: started managed client using command ${command} ${args.join(' ')}.`
  );
}

export async function stopManagedVoiceClient(
  state: ManagedVoiceClientState
): Promise<void> {
  const child = state.childProcess;
  if (!child) {
    return;
  }

  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => {
      if (state.childProcess) {
        child.kill('SIGKILL');
      }
    }, 5000);

    const finish = () => {
      clearTimeout(timeout);
      state.childProcess = null;
      resolve();
    };

    child.once('exit', () => {
      finish();
    });

    if (child.killed) {
      finish();
      return;
    }

    child.kill('SIGTERM');
  });
}
