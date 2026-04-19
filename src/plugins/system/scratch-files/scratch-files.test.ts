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
import writeScratchFileTool from './tools/write-scratch-file.js';
import readScratchFileTool from './tools/read-scratch-file.js';
import deleteScratchFileTool from './tools/delete-scratch-file.js';
import appendScratchFileTool from './tools/append-scratch-file.js';
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

describe('writeScratchFile', () => {
  let tmpDir: string;
  let config: ScratchFilesPluginConfigSchema;
  let execute: (args: any) => Promise<string>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-scratch-'));
    config = makeConfig({ scratchDirectory: tmpDir });
    execute = writeScratchFileTool(config).execute as (
      args: any
    ) => Promise<string>;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a file and returns success message', async () => {
    const result = await execute({ filename: 'notes.txt', contents: 'hello' });
    expect(result).toContain('Written file notes.txt');
    expect(result).toContain('5 characters written');
    expect(fs.readFileSync(path.join(tmpDir, 'notes.txt'), 'utf-8')).toBe(
      'hello'
    );
  });

  it('creates scratch directory if it does not exist', async () => {
    const nestedDir = path.join(tmpDir, 'new-subdir');
    const cfg = makeConfig({ scratchDirectory: nestedDir });
    const exec = writeScratchFileTool(cfg).execute as (
      args: any
    ) => Promise<string>;

    const result = await exec({ filename: 'notes.txt', contents: 'data' });
    expect(result).toContain('Written file');
    expect(fs.existsSync(path.join(nestedDir, 'notes.txt'))).toBe(true);
  });

  it('rejects a disallowed file extension', async () => {
    const result = await execute({ filename: 'bad.exe', contents: 'boom' });
    expect(result).toContain('Error: File type not allowed');
  });

  it('rejects forward-slash path traversal', async () => {
    const result = await execute({
      filename: '../escape.txt',
      contents: 'data',
    });
    expect(result).toContain('Error: Invalid filename');
  });

  it('rejects backslash path traversal', async () => {
    const result = await execute({
      filename: 'sub\\file.txt',
      contents: 'data',
    });
    expect(result).toContain('Error: Invalid filename');
  });

  it('rejects double-dot path traversal', async () => {
    const result = await execute({
      filename: '..secrets.txt',
      contents: 'data',
    });
    expect(result).toContain('Error: Invalid filename');
  });

  it('rejects content exceeding maxFileSizeKB', async () => {
    const bigContent = 'x'.repeat(config.maxFileSizeKB * 1024 + 1);
    const result = await execute({ filename: 'big.txt', contents: bigContent });
    expect(result).toContain('Error: File size exceeds');
  });

  it('rejects overwrite when allowOverwrite is false', async () => {
    const cfg = makeConfig({
      scratchDirectory: tmpDir,
      allowOverwrite: false,
    });
    const exec = writeScratchFileTool(cfg).execute as (
      args: any
    ) => Promise<string>;
    fs.writeFileSync(path.join(tmpDir, 'existing.txt'), 'original');
    const result = await exec({
      filename: 'existing.txt',
      contents: 'new content',
    });
    expect(result).toContain('Error: File already exists');
    // Original should be unchanged
    expect(fs.readFileSync(path.join(tmpDir, 'existing.txt'), 'utf-8')).toBe(
      'original'
    );
  });

  it('overwrites when allowOverwrite is true', async () => {
    fs.writeFileSync(path.join(tmpDir, 'existing.txt'), 'original');
    const result = await execute({
      filename: 'existing.txt',
      contents: 'updated',
    });
    expect(result).toContain('Written file');
    expect(fs.readFileSync(path.join(tmpDir, 'existing.txt'), 'utf-8')).toBe(
      'updated'
    );
  });
});

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

describe('appendScratchFile', () => {
  let tmpDir: string;
  let config: ScratchFilesPluginConfigSchema;
  let execute: (args: any) => Promise<string>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-scratch-'));
    config = makeConfig({ scratchDirectory: tmpDir });
    execute = appendScratchFileTool(config).execute as (
      args: any
    ) => Promise<string>;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new file when target does not exist', async () => {
    const result = await execute({
      filename: 'log.txt',
      contents: 'first line',
    });
    expect(result).toContain('Updated file log.txt');
    expect(fs.readFileSync(path.join(tmpDir, 'log.txt'), 'utf-8')).toBe(
      'first line'
    );
  });

  it('appends a newline and new content to an existing file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'log.txt'), 'line 1');
    await execute({ filename: 'log.txt', contents: 'line 2' });
    expect(fs.readFileSync(path.join(tmpDir, 'log.txt'), 'utf-8')).toBe(
      'line 1\nline 2'
    );
  });

  it('rejects a disallowed file extension', async () => {
    const result = await execute({ filename: 'bad.csv', contents: 'data' });
    expect(result).toContain('Error: File type not allowed');
  });

  it('rejects path traversal', async () => {
    const result = await execute({
      filename: '../escape.txt',
      contents: 'data',
    });
    expect(result).toContain('Error: Invalid filename');
  });

  it('rejects new content that alone exceeds maxFileSizeKB', async () => {
    const bigContent = 'x'.repeat(config.maxFileSizeKB * 1024 + 1);
    const result = await execute({ filename: 'big.txt', contents: bigContent });
    expect(result).toContain('Error: File size exceeds');
  });

  it('rejects append that would push combined size over maxFileSizeKB', async () => {
    // Write a file that uses most of the budget
    const halfKB = Math.floor((config.maxFileSizeKB * 1024) / 2);
    fs.writeFileSync(path.join(tmpDir, 'log.txt'), 'x'.repeat(halfKB));
    // Appending another halfKB + 1 should exceed the limit
    const result = await execute({
      filename: 'log.txt',
      contents: 'y'.repeat(halfKB + 2),
    });
    expect(result).toContain('Error: Appending this content');
    expect(result).toContain('exceed the maximum allowed size');
  });

  it('returns character count in success message', async () => {
    const result = await execute({
      filename: 'notes.txt',
      contents: 'abc',
    });
    expect(result).toContain('3 characters appended');
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
