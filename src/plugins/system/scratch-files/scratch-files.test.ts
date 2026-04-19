/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Stub the circular-dep chain: scratch-files.ts → lib.js → conversation.ts → plugin-hooks.ts
vi.mock('../../../lib/plugin-hooks.js', () => ({
  PluginHooks: vi.fn(() => ({})),
  PluginHookInvocations: {
    invokeOnContextCompactionSummariesWillBeDeleted: vi
      .fn()
      .mockResolvedValue(undefined),
    invokeOnUserConversationWillBegin: vi.fn().mockResolvedValue(undefined),
    invokeOnUserConversationWillEnd: vi.fn().mockResolvedValue(undefined),
  },
}));

// Stub out index freshening — it calls the LLM and is out-of-scope for unit tests.
vi.mock('./scratch-files-index.js', () => ({
  freshenScratchFilesIndex: vi.fn().mockResolvedValue(undefined),
  reindexScratchFiles: vi.fn().mockResolvedValue(undefined),
}));

import type { AlicePluginInterface } from '../../../lib.js';
import type { Tool } from '../../../lib/tool-system.js';
import scratchFilesPlugin, {
  ScratchFilesPluginConfigSchema,
} from './scratch-files.js';
import updateScratchFileTool from './tools/update-scratch-file.js';
import readScratchFileTool from './tools/read-scratch-file.js';
import deleteScratchFileTool from './tools/delete-scratch-file.js';
import listScratchFilesTool from './tools/list-scratch-files.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<ScratchFilesPluginConfigSchema> = {}
): ScratchFilesPluginConfigSchema {
  return {
    scratchDirectory: '',
    allowedFileTypes: ['txt', 'md'],
    maxFileSizeKB: 10,
    allowOverwrite: true,
    ...overrides,
  };
}

function createMockPluginInterface() {
  const registeredTools: Tool[] = [];
  const configValues: Record<string, any> = {};

  return {
    registeredTools,
    configValues,
    registerPlugin: async () => ({
      registerTool: (tool: Tool) => registeredTools.push(tool),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      config: async (_schema: any, defaults: any) => ({
        getPluginConfig: () => ({ ...defaults, ...configValues.plugin }),
        getSystemConfig: () => ({}),
      }),
      hooks: {
        onAllPluginsLoaded: vi.fn(),
        onAssistantWillAcceptRequests: vi.fn(),
        onAssistantAcceptsRequests: vi.fn(),
        onAssistantWillStopAcceptingRequests: vi.fn(),
        onAssistantStoppedAcceptingRequests: vi.fn(),
        onPluginsWillUnload: vi.fn(),
        onTaskAssistantWillBegin: vi.fn(),
        onTaskAssistantWillEnd: vi.fn(),
        onUserConversationWillBegin: vi.fn(),
        onUserConversationWillEnd: vi.fn(),
        onContextCompactionSummariesWillBeDeleted: vi.fn(),
      },
      offer: vi.fn(),
      request: vi.fn(),
    }),
  };
}

// ---------------------------------------------------------------------------
// Plugin-level tests
// ---------------------------------------------------------------------------

describe('scratchFilesPlugin', () => {
  it('has correct plugin metadata', () => {
    expect(scratchFilesPlugin.pluginMetadata).toMatchObject({
      id: 'scratch-files',
      name: 'Scratch Files Plugin',
      version: 'LATEST',
      required: true,
      dependencies: [],
    });
  });

  it('registers 4 tools', async () => {
    const mockInterface = createMockPluginInterface();
    await scratchFilesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    expect(mockInterface.registeredTools).toHaveLength(4);
  });

  it('registers all expected tool names', async () => {
    const mockInterface = createMockPluginInterface();
    await scratchFilesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    const names = mockInterface.registeredTools.map(t => t.name);
    expect(names).toContain('updateScratchFile');
    expect(names).toContain('readScratchFile');
    expect(names).toContain('deleteScratchFile');
    expect(names).toContain('listScratchFiles');
  });
});

// ---------------------------------------------------------------------------
// Tool tests (using a real temp directory)
// ---------------------------------------------------------------------------

describe('readScratchFile', () => {
  let tmpDir: string;
  let config: ScratchFilesPluginConfigSchema;
  let execute: (args: any) => Promise<string>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-scratch-'));
    config = makeConfig({ scratchDirectory: tmpDir });
    execute = readScratchFileTool(config).execute as (
      args: any
    ) => Promise<string>;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns file contents wrapped in begin/end markers', async () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'my notes');
    const result = await execute({ filename: 'notes.txt' });
    expect(result).toContain('== BEGIN FILE ==');
    expect(result).toContain('my notes');
    expect(result).toContain('== END FILE ==');
  });

  it('errors when file does not exist', async () => {
    const result = await execute({ filename: 'missing.txt' });
    expect(result).toContain('Error: File missing.txt does not exist');
  });

  it('rejects a disallowed file extension', async () => {
    const result = await execute({ filename: 'bad.jpg' });
    expect(result).toContain('Error: File type not allowed');
  });

  it('rejects path traversal', async () => {
    const result = await execute({ filename: '../etc/passwd.txt' });
    expect(result).toContain('Error: Invalid filename');
  });
});

// ---------------------------------------------------------------------------

describe('deleteScratchFile', () => {
  let tmpDir: string;
  let config: ScratchFilesPluginConfigSchema;
  let execute: (args: any) => Promise<string>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-scratch-'));
    config = makeConfig({ scratchDirectory: tmpDir });
    execute = deleteScratchFileTool(config).execute as (
      args: any
    ) => Promise<string>;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes an existing file and confirms', async () => {
    fs.writeFileSync(path.join(tmpDir, 'temp.txt'), 'data');
    const result = await execute({ filename: 'temp.txt' });
    expect(result).toContain('Deleted file temp.txt');
    expect(fs.existsSync(path.join(tmpDir, 'temp.txt'))).toBe(false);
  });

  it('errors when file does not exist', async () => {
    const result = await execute({ filename: 'ghost.txt' });
    expect(result).toContain('Error: File ghost.txt does not exist');
  });

  it('rejects a disallowed file extension', async () => {
    const result = await execute({ filename: 'bad.bin' });
    expect(result).toContain('Error: File type not allowed');
  });

  it('rejects path traversal', async () => {
    const result = await execute({ filename: '../important.txt' });
    expect(result).toContain('Error: Invalid filename');
  });
});

// ---------------------------------------------------------------------------

describe('listScratchFiles', () => {
  let tmpDir: string;
  let config: ScratchFilesPluginConfigSchema;
  let execute: () => Promise<string>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-scratch-'));
    config = makeConfig({ scratchDirectory: tmpDir });
    execute = listScratchFilesTool(config).execute as () => Promise<string>;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists allowed files in the scratch directory', async () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), '');
    fs.writeFileSync(path.join(tmpDir, 'journal.md'), '');
    const result = await execute();
    expect(result).toContain('notes.txt');
    expect(result).toContain('journal.md');
  });

  it('omits files with disallowed extensions', async () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), '');
    fs.writeFileSync(path.join(tmpDir, 'image.jpg'), '');
    const result = await execute();
    expect(result).toContain('notes.txt');
    expect(result).not.toContain('image.jpg');
  });

  it('reports empty when directory has no matching files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'image.png'), '');
    const result = await execute();
    // The directory is not empty but no allowed files — list shows no allowed files
    expect(result).toContain('Files in your internal scratch directory:');
  });

  it('reports empty when directory does not exist', async () => {
    const nonExistent = path.join(tmpDir, 'no-such-dir');
    const cfg = makeConfig({ scratchDirectory: nonExistent });
    const exec = listScratchFilesTool(cfg).execute as () => Promise<string>;
    const result = await exec();
    expect(result).toContain('empty');
  });

  it('reports empty for an empty directory', async () => {
    const result = await execute();
    expect(result).toContain('empty');
  });
});

// ---------------------------------------------------------------------------

describe('updateScratchFile', () => {
  type UpdateScratchFileArgs = {
    filename: string;
    format: 'full' | 'diff';
    contents: string;
  };

  let tmpDir: string;
  let config: ScratchFilesPluginConfigSchema;
  let execute: (args: UpdateScratchFileArgs) => Promise<string>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-scratch-'));
    config = makeConfig({ scratchDirectory: tmpDir });
    execute = updateScratchFileTool(config).execute as (
      args: UpdateScratchFileArgs
    ) => Promise<string>;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes full content to a new file', async () => {
    const result = await execute({
      filename: 'notes.txt',
      format: 'full',
      contents: 'first draft',
    });
    expect(result).toContain('Written file notes.txt');
    expect(fs.readFileSync(path.join(tmpDir, 'notes.txt'), 'utf-8')).toBe(
      'first draft'
    );
  });

  it('applies a unified diff update to an existing file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'hello\nworld\n');
    const result = await execute({
      filename: 'notes.txt',
      format: 'diff',
      contents:
        '--- notes.txt\n+++ notes.txt\n@@ -1,2 +1,2 @@\n hello\n-world\n+alice\n',
    });
    expect(result).toContain('Updated file notes.txt');
    expect(fs.readFileSync(path.join(tmpDir, 'notes.txt'), 'utf-8')).toBe(
      'hello\nalice\n'
    );
  });

  it('rejects invalid diff patches', async () => {
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'hello\nworld\n');
    const result = await execute({
      filename: 'notes.txt',
      format: 'diff',
      contents: 'this is not a diff',
    });
    expect(result).toContain('ERROR! UPDATE REJECTED.');
  });

  it('rejects path traversal attempts', async () => {
    const result = await execute({
      filename: '../notes.txt',
      format: 'full',
      contents: 'content',
    });
    expect(result).toContain('Error: Invalid filename');
  });

  it('enforces max file size limits', async () => {
    const smallConfig = makeConfig({
      scratchDirectory: tmpDir,
      maxFileSizeKB: 1,
    });
    const smallExecute = updateScratchFileTool(smallConfig).execute as (
      args: UpdateScratchFileArgs
    ) => Promise<string>;
    const result = await smallExecute({
      filename: 'large.txt',
      format: 'full',
      contents: 'x'.repeat(10 * 1024),
    });
    expect(result).toContain(
      'Error: Content size exceeds the maximum allowed size of 1 KB.'
    );
  });
});
