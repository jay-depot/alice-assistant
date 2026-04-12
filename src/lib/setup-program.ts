import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import blessed from 'blessed';
import { UserConfig } from './user-config.js';

type SetupArgs = {
  defaults: boolean;
  forceVenv: boolean;
  quiet: boolean;
  help: boolean;
  plain: boolean;
};

type PromptSession = {
  question: (text: string) => Promise<string>;
  selectMany: (
    title: string,
    options: Array<{ id: string; label: string; selected: boolean }>
  ) => Promise<string[]>;
  close: () => void;
  printSection: (title: string) => void;
  printInfo: (message: string) => void;
  printWarning: (message: string) => void;
};

type SystemPluginEntry = {
  id: string;
  name: string;
  category: string;
  required: boolean;
};

type EnabledPluginsFile = {
  system: Record<string, boolean>;
  user: {
    enableUserPlugins: boolean;
    plugins: string[];
  };
};

type VoiceSetupResult = {
  pythonPath: string;
  venvPath: string;
};

type SetupSystemConfig = {
  wakeWord?: string;
  assistantName?: string;
  location?: string;
  webInterface?: {
    enabled?: boolean;
    port?: number;
    bindToAddress?: string;
  };
  ollama?: {
    host?: string;
    model?: string;
    options?: {
      num_ctx?: number;
    };
  };
  piperTts?: {
    host?: string;
    model?: string;
    speaker?: number;
  };
  openWakeWord?: {
    model?: string;
  };
  [key: string]: unknown;
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const packageRootDir = path.resolve(currentDir, '..', '..');
const defaultConfigDir = path.join(packageRootDir, 'config-default');
const defaultEnabledPluginsPath = path.join(
  defaultConfigDir,
  'plugin-settings',
  'enabled-plugins.json'
);
const defaultVoiceConfigPath = path.join(
  defaultConfigDir,
  'plugin-settings',
  'voice',
  'voice.json'
);
const systemPluginsRegistryCandidatePaths = [
  path.join(packageRootDir, 'src', 'plugins', 'system-plugins.json'),
  path.join(packageRootDir, 'dist', 'plugins', 'system-plugins.json'),
];
const voiceRequirementsCandidatePaths = [
  path.join(
    packageRootDir,
    'src',
    'plugins',
    'system',
    'voice',
    'client',
    'requirements.txt'
  ),
  path.join(
    packageRootDir,
    'dist',
    'plugins',
    'system',
    'voice',
    'client',
    'requirements.txt'
  ),
];
const setupExtrasPath = path.join(
  defaultConfigDir,
  'plugin-settings',
  'voice',
  'setup-python-extras.json'
);

function parseArgs(argv: string[]): SetupArgs {
  return {
    defaults: argv.includes('--defaults') || argv.includes('--yes'),
    forceVenv: argv.includes('--force-venv'),
    quiet: argv.includes('--quiet') || argv.includes('-q'),
    help: argv.includes('--help') || argv.includes('-h'),
    plain: argv.includes('--plain'),
  };
}

function createReadlinePromptSession(): PromptSession {
  const rl = readline.createInterface({ input, output });

  const selectMany: PromptSession['selectMany'] = async (_title, options) => {
    const selected: string[] = [];
    for (const option of options) {
      const answer = await rl.question(
        `${option.label} (${option.selected ? 'Y/n' : 'y/N'}): `
      );
      const value = answer.trim();
      const enabled = value ? isYes(value) : option.selected;
      if (enabled) {
        selected.push(option.id);
      }
    }
    return selected;
  };

  return {
    question: (text: string) => rl.question(text),
    selectMany,
    close: () => rl.close(),
    printSection: (title: string) => {
      console.log('');
      console.log(`== ${title} ==`);
    },
    printInfo: (message: string) => {
      console.log(message);
    },
    printWarning: (message: string) => {
      console.warn(message);
    },
  };
}

function createBlessedPromptSession(): PromptSession {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'A.L.I.C.E Setup',
    fullUnicode: true,
  });

  const frame = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    border: 'line',
    style: {
      border: { fg: 'cyan' },
    },
  });

  const header = blessed.box({
    parent: frame,
    top: 0,
    left: 1,
    width: '100%-2',
    height: 3,
    tags: true,
    content: '{bold}A.L.I.C.E Setup{/bold}',
  });

  const logPanel = blessed.log({
    parent: frame,
    top: 2,
    left: 1,
    width: '100%-2',
    height: '100%-3',
    border: 'line',
    label: ' Setup Activity ',
    tags: true,
    keys: true,
    vi: true,
    scrollable: true,
    alwaysScroll: true,
    style: {
      border: { fg: 'blue' },
    },
  });

  const promptDialog = blessed.prompt({
    parent: screen,
    border: 'line',
    height: 'shrink',
    width: '70%',
    top: 'center',
    left: 'center',
    label: ' Input ',
    keys: true,
    vi: true,
    tags: true,
  });

  const checkboxDialog = blessed.box({
    parent: screen,
    border: 'line',
    width: '80%',
    height: '75%',
    top: 'center',
    left: 'center',
    label: ' Plugin Selection ',
    tags: true,
    hidden: true,
    style: {
      border: { fg: 'green' },
    },
  });

  const checkboxList = blessed.list({
    parent: checkboxDialog,
    top: 2,
    left: 1,
    width: '100%-2',
    height: '100%-4',
    keys: true,
    vi: true,
    mouse: true,
    tags: true,
    border: 'line',
    style: {
      selected: { bg: 'blue', fg: 'white' },
      item: { fg: 'white' },
      border: { fg: 'green' },
    },
  });

  const render = () => screen.render();
  const printInfo = (message: string) => {
    logPanel.add(message);
    render();
  };

  screen.key(['C-c'], () => {
    screen.destroy();
    process.exit(130);
  });

  render();

  return {
    question: async (text: string) => {
      return await new Promise<string>(resolve => {
        promptDialog.input(text, '', (_err, value) => {
          const normalized = `${value ?? ''}`;
          logPanel.add(`{bold}> ${text}{/bold}`);
          if (normalized.trim()) {
            logPanel.add(`  ${normalized}`);
          }
          render();
          resolve(normalized);
        });
      });
    },
    selectMany: async (title, options) => {
      return await new Promise<string[]>(resolve => {
        const states = options.map(option => ({ ...option }));

        const renderItems = () => {
          checkboxDialog.setLabel(` ${title} `);
          checkboxList.setItems(
            states.map(option => {
              const marker = option.selected
                ? '{green-fg}[x]{/green-fg}'
                : '[ ]';
              return `${marker} ${option.label}`;
            })
          );
          render();
        };

        const cleanup = (keepDefaults: boolean) => {
          checkboxList.removeAllListeners('keypress');
          checkboxDialog.hide();
          logPanel.show();
          frame.focus();
          render();

          if (keepDefaults) {
            resolve(
              options.filter(option => option.selected).map(option => option.id)
            );
            return;
          }

          resolve(
            states.filter(option => option.selected).map(option => option.id)
          );
        };

        checkboxDialog.show();
        logPanel.hide();
        renderItems();
        checkboxList.focus();

        checkboxList.key(['space'], () => {
          const index = checkboxList.selected;
          if (index < 0 || index >= states.length) {
            return;
          }
          states[index].selected = !states[index].selected;
          renderItems();
          checkboxList.select(index);
        });

        checkboxList.key(['enter'], () => {
          cleanup(false);
        });

        checkboxList.key(['escape'], () => {
          cleanup(true);
        });
      });
    },
    close: () => {
      screen.destroy();
    },
    printSection: (title: string) => {
      header.setContent(`{bold}${title}{/bold}`);
      logPanel.add(`{cyan-fg}${title}{/cyan-fg}`);
      render();
    },
    printInfo,
    printWarning: (message: string) => {
      logPanel.add(`{yellow-fg}${message}{/yellow-fg}`);
      render();
    },
  };
}

function createPromptSession(args: SetupArgs): PromptSession {
  if (args.plain || args.defaults || args.quiet || !process.stdout.isTTY) {
    return createReadlinePromptSession();
  }

  try {
    return createBlessedPromptSession();
  } catch {
    return createReadlinePromptSession();
  }
}

async function firstReadablePath(
  candidatePaths: string[]
): Promise<string | null> {
  for (const candidatePath of candidatePaths) {
    try {
      await fs.access(candidatePath, fsConstants.R_OK);
      return candidatePath;
    } catch {
      // Try next path.
    }
  }

  return null;
}

function isYes(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'y' ||
    normalized === 'yes' ||
    normalized === 'true' ||
    normalized === '1'
  );
}

function toNumberOrDefault(rawValue: string, fallback: number): number {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeOllamaHost(rawValue: string, fallback: string): string {
  const value = rawValue.trim() || fallback;
  if (!/^https?:\/\//i.test(value)) {
    return `http://${value}`;
  }
  return value;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function commandExists(commandName: string): Promise<boolean> {
  const checkCommand = process.platform === 'win32' ? 'where' : 'which';
  return new Promise(resolve => {
    const child = spawn(checkCommand, [commandName], {
      stdio: 'ignore',
    });

    child.on('close', code => {
      resolve(code === 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}

async function runCommand(
  command: string,
  args: string[],
  stdio: 'inherit' | 'pipe'
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} exited with code ${code ?? 'null'}.`
        )
      );
    });
  });
}

async function askQuestion(
  session: PromptSession,
  question: string,
  defaultValue: string,
  defaultsMode: boolean
): Promise<string> {
  if (defaultsMode) {
    return defaultValue;
  }

  const promptSuffix = defaultValue ? ` [${defaultValue}]` : '';
  const value = await session.question(`${question}${promptSuffix}: `);
  return value.trim() || defaultValue;
}

async function askYesNo(
  session: PromptSession,
  question: string,
  defaultValue: boolean,
  defaultsMode: boolean
): Promise<boolean> {
  if (defaultsMode) {
    return defaultValue;
  }

  const label = defaultValue ? 'Y/n' : 'y/N';
  const value = await session.question(`${question} (${label}): `);
  if (!value.trim()) {
    return defaultValue;
  }
  return isYes(value);
}

async function probeOllama(host: string): Promise<boolean> {
  try {
    const target = `${host.replace(/\/$/, '')}/api/version`;
    const response = await fetch(target, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function loadSystemPlugins(): Promise<SystemPluginEntry[]> {
  const registryPath = await firstReadablePath(
    systemPluginsRegistryCandidatePaths
  );
  if (!registryPath) {
    throw new Error(
      `Could not find system plugin registry in any known location: ${systemPluginsRegistryCandidatePaths.join(', ')}`
    );
  }

  return readJsonFile<SystemPluginEntry[]>(registryPath);
}

async function ensureBundledFilesExist(): Promise<void> {
  const systemPluginsRegistryPath = await firstReadablePath(
    systemPluginsRegistryCandidatePaths
  );
  const voiceRequirementsPath = await firstReadablePath(
    voiceRequirementsCandidatePaths
  );

  const requiredFiles = [
    defaultConfigDir,
    defaultEnabledPluginsPath,
    defaultVoiceConfigPath,
  ];

  if (systemPluginsRegistryPath) {
    requiredFiles.push(systemPluginsRegistryPath);
  }

  if (voiceRequirementsPath) {
    requiredFiles.push(voiceRequirementsPath);
  }

  for (const target of requiredFiles) {
    try {
      await fs.access(target, fsConstants.R_OK);
    } catch {
      throw new Error(
        `Setup cannot continue because a required bundled file is missing: ${target}`
      );
    }
  }

  if (!systemPluginsRegistryPath) {
    throw new Error(
      `Setup cannot continue because system plugin registry was not found. Looked in: ${systemPluginsRegistryCandidatePaths.join(', ')}`
    );
  }

  if (!voiceRequirementsPath) {
    throw new Error(
      `Setup cannot continue because voice requirements file was not found. Looked in: ${voiceRequirementsCandidatePaths.join(', ')}`
    );
  }
}

async function loadPythonExtras(): Promise<string[]> {
  try {
    const extras = await readJsonFile<{ extras: string[] }>(setupExtrasPath);
    if (!Array.isArray(extras.extras)) {
      return [];
    }

    return extras.extras
      .map(entry => `${entry}`.trim())
      .filter(entry => entry.length > 0);
  } catch {
    return [];
  }
}

async function configureEnabledPlugins(
  session: PromptSession,
  defaultsMode: boolean,
  currentEnabledPlugins: EnabledPluginsFile
): Promise<EnabledPluginsFile> {
  const systemPlugins = await loadSystemPlugins();
  const updatedSystemState: Record<string, boolean> = {
    ...currentEnabledPlugins.system,
  };

  const optionalPlugins = systemPlugins.filter(plugin => !plugin.required);
  const requiredPlugins = systemPlugins.filter(plugin => plugin.required);

  for (const plugin of requiredPlugins) {
    updatedSystemState[plugin.id] = true;
  }

  if (optionalPlugins.length > 0) {
    if (defaultsMode) {
      for (const plugin of optionalPlugins) {
        updatedSystemState[plugin.id] = !!updatedSystemState[plugin.id];
      }
    } else {
      const selectedOptionalPluginIds = await session.selectMany(
        'Plugin Selection',
        optionalPlugins.map(plugin => ({
          id: plugin.id,
          label: `${plugin.id} (${plugin.category})`,
          selected: !!updatedSystemState[plugin.id],
        }))
      );
      const selectedSet = new Set(selectedOptionalPluginIds);
      for (const plugin of optionalPlugins) {
        updatedSystemState[plugin.id] = selectedSet.has(plugin.id);
      }
    }
  }

  const userPluginsEnabled = await askYesNo(
    session,
    'Enable user plugins',
    currentEnabledPlugins.user.enableUserPlugins,
    defaultsMode
  );

  return {
    system: updatedSystemState,
    user: {
      enableUserPlugins: userPluginsEnabled,
      plugins: [...(currentEnabledPlugins.user.plugins || [])],
    },
  };
}

async function configureCoreSettings(
  session: PromptSession,
  defaultsMode: boolean,
  currentConfig: SetupSystemConfig
): Promise<SetupSystemConfig> {
  const wakeWord = await askQuestion(
    session,
    'Wake word',
    currentConfig.wakeWord ?? 'Hey ALICE',
    defaultsMode
  );
  const assistantName = await askQuestion(
    session,
    'Assistant name',
    currentConfig.assistantName ?? 'ALICE',
    defaultsMode
  );
  const location = await askQuestion(
    session,
    'Location',
    currentConfig.location ?? '',
    defaultsMode
  );

  const webEnabled = await askYesNo(
    session,
    'Enable web interface',
    currentConfig.webInterface?.enabled ?? true,
    defaultsMode
  );
  const webPortRaw = await askQuestion(
    session,
    'Web interface port',
    `${currentConfig.webInterface?.port ?? 47153}`,
    defaultsMode
  );
  const webBind = await askQuestion(
    session,
    'Web interface bind address',
    currentConfig.webInterface?.bindToAddress ?? '127.0.0.1',
    defaultsMode
  );

  const ollamaHostRaw = await askQuestion(
    session,
    'Ollama host',
    currentConfig.ollama?.host ?? 'http://127.0.0.1:11434',
    defaultsMode
  );
  const ollamaModel = await askQuestion(
    session,
    'Ollama model',
    currentConfig.ollama?.model ?? 'qwen2:7b',
    defaultsMode
  );
  const ollamaNumCtxRaw = await askQuestion(
    session,
    'Ollama num_ctx',
    `${currentConfig.ollama?.options?.num_ctx ?? 32000}`,
    defaultsMode
  );

  const piperHost = await askQuestion(
    session,
    'Piper TTS host',
    currentConfig.piperTts?.host ?? 'http://127.0.0.1:5000',
    defaultsMode
  );
  const piperModel = await askQuestion(
    session,
    'Piper model path',
    currentConfig.piperTts?.model ?? '',
    defaultsMode
  );
  const piperSpeakerRaw = await askQuestion(
    session,
    'Piper speaker id',
    `${currentConfig.piperTts?.speaker ?? 0}`,
    defaultsMode
  );

  const openWakeWordModel = await askQuestion(
    session,
    'OpenWakeWord model path',
    currentConfig.openWakeWord?.model ?? '',
    defaultsMode
  );

  const normalizedOllamaHost = normalizeOllamaHost(
    ollamaHostRaw,
    currentConfig.ollama?.host ?? 'http://127.0.0.1:11434'
  );

  return {
    ...currentConfig,
    wakeWord,
    assistantName,
    location,
    webInterface: {
      enabled: webEnabled,
      port: toNumberOrDefault(
        webPortRaw,
        currentConfig.webInterface?.port ?? 47153
      ),
      bindToAddress: webBind,
    },
    ollama: {
      ...(currentConfig.ollama ?? {}),
      host: normalizedOllamaHost,
      model: ollamaModel,
      options: {
        ...(currentConfig.ollama?.options ?? {}),
        num_ctx: toNumberOrDefault(
          ollamaNumCtxRaw,
          currentConfig.ollama?.options?.num_ctx ?? 32000
        ),
      },
    },
    piperTts: {
      ...(currentConfig.piperTts ?? {}),
      host: piperHost,
      model: piperModel,
      speaker: toNumberOrDefault(
        piperSpeakerRaw,
        currentConfig.piperTts?.speaker ?? 0
      ),
    },
    openWakeWord: {
      ...(currentConfig.openWakeWord ?? {}),
      model: openWakeWordModel,
    },
  };
}

function printHelp(): void {
  console.log('alice-assistant-setup');
  console.log('Usage: alice-assistant-setup [options]');
  console.log('');
  console.log('Options:');
  console.log('  --defaults, --yes    Accept defaults for all prompts');
  console.log(
    '  --force-venv         Recreate ~/.alice-assistant/voice-venv if it already exists'
  );
  console.log('  --quiet, -q          Reduce setup output');
  console.log(
    '  --plain              Disable Blessed UI and use plain prompts'
  );
  console.log('  --help, -h           Show this help message');
}

async function setupVoiceVenv(options: {
  configDir: string;
  defaultsMode: boolean;
  forceVenv: boolean;
  quiet: boolean;
  session: PromptSession;
}): Promise<VoiceSetupResult | null> {
  const { configDir, defaultsMode, forceVenv, quiet, session } = options;
  const venvPath = path.join(configDir, 'voice-venv');
  const venvPythonPath = path.join(venvPath, 'bin', 'python');
  const venvPipPath = path.join(venvPath, 'bin', 'pip');

  const shouldSetupVoice = await askYesNo(
    session,
    'Provision voice Python environment now',
    true,
    defaultsMode
  );
  if (!shouldSetupVoice) {
    return null;
  }

  const hasPython = await commandExists('python3');
  if (!hasPython) {
    throw new Error(
      'python3 is required but was not found on PATH. Install python3 and rerun alice-assistant-setup.'
    );
  }

  const venvExists = await fs
    .access(venvPythonPath)
    .then(() => true)
    .catch(() => false);
  const shouldRecreate =
    venvExists &&
    (forceVenv ||
      (await askYesNo(
        session,
        'voice-venv already exists. Recreate it',
        false,
        defaultsMode
      )));

  if (venvExists && shouldRecreate) {
    if (!quiet) {
      console.log(`Removing existing venv at ${venvPath}...`);
    }
    await fs.rm(venvPath, { recursive: true, force: true });
  }

  const finalVenvExists = await fs
    .access(venvPythonPath)
    .then(() => true)
    .catch(() => false);
  if (!finalVenvExists) {
    if (!quiet) {
      console.log(`Creating venv at ${venvPath}...`);
    }
    await runCommand(
      'python3',
      ['-m', 'venv', venvPath],
      quiet ? 'pipe' : 'inherit'
    );
  }

  if (!quiet) {
    console.log('Installing required voice dependencies...');
  }
  const voiceRequirementsPath = await firstReadablePath(
    voiceRequirementsCandidatePaths
  );
  if (!voiceRequirementsPath) {
    throw new Error(
      `Could not locate voice requirements file. Looked in: ${voiceRequirementsCandidatePaths.join(', ')}`
    );
  }

  await runCommand(
    venvPipPath,
    ['install', '-r', voiceRequirementsPath],
    quiet ? 'pipe' : 'inherit'
  );

  const bundledExtras = await loadPythonExtras();
  const extrasInput = await askQuestion(
    session,
    'Additional pip packages (comma-separated)',
    bundledExtras.join(', '),
    defaultsMode
  );
  const extras = extrasInput
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);

  if (extras.length > 0) {
    if (!quiet) {
      console.log(`Installing extras: ${extras.join(', ')}`);
    }
    await runCommand(
      venvPipPath,
      ['install', ...extras],
      quiet ? 'pipe' : 'inherit'
    );
  }

  await runCommand(
    venvPythonPath,
    ['-c', 'import numpy, openwakeword, sounddevice; print("voice-deps-ok")'],
    quiet ? 'pipe' : 'inherit'
  );

  return {
    pythonPath: venvPythonPath,
    venvPath,
  };
}

async function updateVoicePluginConfig(options: {
  configDir: string;
  defaultsMode: boolean;
  session: PromptSession;
  pythonPath: string | null;
}): Promise<void> {
  const { configDir, defaultsMode, session, pythonPath } = options;
  const voiceConfigDir = path.join(configDir, 'plugin-settings', 'voice');
  const voiceConfigPath = path.join(voiceConfigDir, 'voice.json');

  const fallback = await readJsonFile<Record<string, unknown>>(
    defaultVoiceConfigPath
  );
  const current = await fs
    .access(voiceConfigPath)
    .then(async () => readJsonFile<Record<string, unknown>>(voiceConfigPath))
    .catch(() => fallback);

  const launchManagedClient = await askYesNo(
    session,
    'Enable managed voice client launch at startup',
    (current.launchManagedClient as boolean | undefined) ?? false,
    defaultsMode
  );

  const updated = {
    ...current,
    launchManagedClient,
    managedClientCommand:
      pythonPath ?? (current.managedClientCommand as string | undefined) ?? '',
  };

  await fs.mkdir(voiceConfigDir, { recursive: true });
  await writeJsonFile(voiceConfigPath, updated);
}

export async function runSetupProgram(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  await ensureBundledFilesExist();

  const session = createPromptSession(args);

  try {
    session.printSection('A.L.I.C.E Setup Wizard');
    session.printInfo(
      'This command scaffolds ~/.alice-assistant and configures voice dependencies.'
    );

    const configDir = UserConfig.getConfigPath();
    const aliceConfigPath = path.join(configDir, 'alice.json');
    const enabledPluginsPath = path.join(
      configDir,
      'plugin-settings',
      'enabled-plugins.json'
    );

    const currentConfig =
      await readJsonFile<SetupSystemConfig>(aliceConfigPath);
    const currentEnabledPlugins = await fs
      .access(enabledPluginsPath)
      .then(async () => readJsonFile<EnabledPluginsFile>(enabledPluginsPath))
      .catch(async () =>
        readJsonFile<EnabledPluginsFile>(defaultEnabledPluginsPath)
      );

    session.printSection('Core Settings');
    const nextConfig = await configureCoreSettings(
      session,
      args.defaults,
      currentConfig
    );
    await writeJsonFile(aliceConfigPath, nextConfig);

    session.printSection('Plugin Selection');
    const nextEnabledPlugins = await configureEnabledPlugins(
      session,
      args.defaults,
      currentEnabledPlugins
    );
    await writeJsonFile(enabledPluginsPath, nextEnabledPlugins);

    session.printSection('Voice Environment');
    const voiceSetup = await setupVoiceVenv({
      configDir,
      defaultsMode: args.defaults,
      forceVenv: args.forceVenv,
      quiet: args.quiet,
      session,
    });

    await updateVoicePluginConfig({
      configDir,
      defaultsMode: args.defaults,
      session,
      pythonPath: voiceSetup?.pythonPath ?? null,
    });

    const ollamaReachable = await probeOllama(
      nextConfig.ollama?.host ?? 'http://127.0.0.1:11434'
    );

    session.printSection('Summary');
    session.printInfo('Setup complete.');
    session.printInfo(`Config directory: ${configDir}`);
    session.printInfo(`alice.json: ${aliceConfigPath}`);
    session.printInfo(`enabled-plugins.json: ${enabledPluginsPath}`);
    session.printInfo(
      `Voice plugin config: ${path.join(configDir, 'plugin-settings', 'voice', 'voice.json')}`
    );
    if (voiceSetup) {
      session.printInfo(`Voice venv: ${voiceSetup.venvPath}`);
      session.printInfo(`Voice python: ${voiceSetup.pythonPath}`);
    }
    if (ollamaReachable) {
      session.printInfo('Ollama reachable: yes');
    } else {
      session.printWarning('Ollama reachable: no');
    }
    session.printInfo('Next step: run alice-assistant-start');
  } finally {
    session.close();
  }
}
