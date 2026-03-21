import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';

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

export async function recordAudioClip(seconds = 7): Promise<string> {
  const outputPath = path.join(os.tmpdir(), `alice-stt-${Date.now()}.wav`);

  const recorder = findFirstAvailableCommand(['arecord', 'ffmpeg']);
  if (!recorder) {
    throw new Error('No recorder found. Install arecord (alsa-utils) or ffmpeg.');
  }

  if (recorder === 'arecord') {
    await runCommand('arecord', ['-q', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-d', String(seconds), outputPath]);
  } else {
    await runCommand('ffmpeg', ['-y', '-f', 'alsa', '-i', 'default', '-ac', '1', '-ar', '16000', '-t', String(seconds), outputPath]);
  }

  return outputPath;
}

async function transcribeWithOpenAIWhisper(audioPath: string, outputDir: string): Promise<string> {
  await runCommand('whisper', [
    audioPath,
    '--model',
    process.env.ALICE_WHISPER_MODEL || 'base',
    '--task',
    'transcribe',
    '--output_format',
    'txt',
    '--output_dir',
    outputDir,
  ]);

  const txtPath = path.join(outputDir, `${path.parse(audioPath).name}.txt`);
  if (!fs.existsSync(txtPath)) {
    throw new Error(`Whisper did not generate expected transcript file at ${txtPath}`);
  }

  return fs.readFileSync(txtPath, 'utf8').trim();
}

async function transcribeWithWhisperCpp(audioPath: string, outputDir: string): Promise<string> {
  const outPrefix = path.join(outputDir, path.parse(audioPath).name);
  await runCommand('whisper-cli', ['-f', audioPath, '-otxt', '-of', outPrefix]);

  const txtPath = `${outPrefix}.txt`;
  if (!fs.existsSync(txtPath)) {
    throw new Error(`whisper-cli did not generate expected transcript file at ${txtPath}`);
  }

  return fs.readFileSync(txtPath, 'utf8').trim();
}

export async function transcribeAudioFile(audioPath: string): Promise<string> {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-whisper-'));
  try {
    const preferredWhisperCommand = process.env.ALICE_WHISPER_CMD;

    if (preferredWhisperCommand === 'whisper') {
      return transcribeWithOpenAIWhisper(audioPath, outputDir);
    }
    if (preferredWhisperCommand === 'whisper-cli') {
      return transcribeWithWhisperCpp(audioPath, outputDir);
    }

    if (findFirstAvailableCommand(['whisper'])) {
      return transcribeWithOpenAIWhisper(audioPath, outputDir);
    }

    if (findFirstAvailableCommand(['whisper-cli'])) {
      return transcribeWithWhisperCpp(audioPath, outputDir);
    }

    throw new Error('No Whisper command found. Install python "whisper" or "whisper-cli".');
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

export async function captureAndTranscribe(seconds = 7): Promise<string> {
  const audioPath = await recordAudioClip(seconds);
  try {
    return await transcribeAudioFile(audioPath);
  } finally {
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  }
}
