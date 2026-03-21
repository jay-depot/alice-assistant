import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { UserConfig } from './user-config.js';

function findFirstAvailableCommand(commands: string[]): string | null {
  for (const command of commands) {
    const check = spawnSync('which', [command], { stdio: 'ignore' });
    if (check.status === 0) {
      return command;
    }
  }
  return null;
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'ignore' });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(' ')} (exit ${code})`));
    });
  });
}

async function writeAudioFromResponse(text: string, destinationPath: string): Promise<void> {
  const config = UserConfig.getConfig().piperTts;
  const baseUrl = String(config.host || '').replace(/\/$/, '');
  const payload = {
    text,
    model: config.model,
    speaker: config.speaker,
  };

  const endpoints = ['/api/tts', '/tts'];

  let lastError: Error | null = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Piper server returned status ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = (await response.json()) as Record<string, unknown>;
        const audioBase64 = json.audioBase64 || json.audio || json.wavBase64;
        if (typeof audioBase64 === 'string') {
          fs.writeFileSync(destinationPath, Buffer.from(audioBase64, 'base64'));
          return;
        }
        throw new Error('Piper JSON response did not include an audio payload.');
      }

      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(`Unable to synthesize speech with piper server at ${baseUrl}: ${lastError?.message || 'unknown error'}`);
}

export async function synthesizeSpeechToTempFile(text: string): Promise<string> {
  const tempPath = path.join(os.tmpdir(), `alice-tts-${Date.now()}.wav`);
  await writeAudioFromResponse(text, tempPath);
  return tempPath;
}

export async function playAudioFile(audioPath: string): Promise<void> {
  const player = findFirstAvailableCommand(['paplay', 'aplay', 'ffplay']);
  if (!player) {
    throw new Error('No audio playback command found. Install paplay, aplay, or ffplay.');
  }

  switch (player) {
    case 'paplay':
      await runCommand('paplay', [audioPath]);
      return;
    case 'aplay':
      await runCommand('aplay', [audioPath]);
      return;
    case 'ffplay':
      await runCommand('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', audioPath]);
      return;
    default:
      throw new Error(`Unsupported audio player: ${player}`);
  }
}

export async function speakText(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  const audioPath = await synthesizeSpeechToTempFile(trimmed);
  try {
    await playAudioFile(audioPath);
  } finally {
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  }
}
