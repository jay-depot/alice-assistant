import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import type { VoicePluginConfig } from './config.js';

export type ManagedVoiceClientState = {
  childProcess: ChildProcess | null;
};

export function createManagedVoiceClientState(): ManagedVoiceClientState {
  return {
    childProcess: null,
  };
}

export function isManagedVoiceClientRunning(state: ManagedVoiceClientState): boolean {
  return !!state.childProcess && !state.childProcess.killed;
}

export function startManagedVoiceClient(options: {
  config: VoicePluginConfig;
  token: string;
  baseUrl: string;
  wakeWord: string;
  clientScriptPath: string;
  state: ManagedVoiceClientState;
}): void {
  const { config, token, baseUrl, wakeWord, clientScriptPath, state } = options;

  if (!config.launchManagedClient) {
    console.log('voice plugin: managed client launch disabled by config.');
    return;
  }

  if (state.childProcess && !state.childProcess.killed) {
    console.log('voice plugin: managed client already running, skipping duplicate launch.');
    return;
  }

  if (!fs.existsSync(clientScriptPath)) {
    throw new Error(`voice plugin could not find bundled client script at ${clientScriptPath}. Rebuild the project and try again.`);
  }

  const command = config.managedClientCommand.trim() || 'python3';
  const args = config.managedClientCommand.trim()
    ? [clientScriptPath, ...config.managedClientArgs]
    : ['-u', clientScriptPath, ...config.managedClientArgs];

  const child = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ALICE_VOICE_BASE_URL: baseUrl,
      ALICE_VOICE_TOKEN: token,
      ALICE_VOICE_WAKE_WORD: wakeWord,
    },
  });

  if (config.logManagedClientOutput) {
    child.stdout.on('data', (chunk) => {
      process.stdout.write(`[voice-client stdout] ${String(chunk)}`);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(`[voice-client stderr] ${String(chunk)}`);
    });
  }

  child.on('exit', (code, signal) => {
    state.childProcess = null;
    console.log(`voice plugin: managed client exited with code ${code ?? 'null'} signal ${signal ?? 'null'}.`);
  });

  child.on('error', (error) => {
    state.childProcess = null;
    console.error('voice plugin: managed client failed to start:', error);
  });

  state.childProcess = child;
  console.log(`voice plugin: started managed client using command ${command} ${args.join(' ')}.`);
}

export async function stopManagedVoiceClient(state: ManagedVoiceClientState): Promise<void> {
  const child = state.childProcess;
  if (!child) {
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
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