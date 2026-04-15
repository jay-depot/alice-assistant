/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

import type { AlicePluginInterface } from '../../../lib.js';
import userFilesPlugin from './user-files.js';
import { SecretsRedactor } from '../../system/credential-store/redactor.js';

type RegisteredTool = {
  name: string;
  execute: (args: any) => Promise<string>;
};

function createMockPluginInterface(configValues: {
  allowedFilePaths: string[];
  allowedFileTypesReadOnly: string[];
  allowedFileTypesWrite: string[];
  maxFileSizeBytes: number;
}) {
  const registeredTools: RegisteredTool[] = [];
  const offeredCapabilities: Record<string, any> = {};

  return {
    registeredTools,
    offeredCapabilities,
    registerPlugin: async () => ({
      registerTool: (tool: RegisteredTool) => registeredTools.push(tool),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      request: vi.fn().mockImplementation((pluginId: string) => {
        if (pluginId === 'credential-store') {
          const mockRedactor = new SecretsRedactor();
          return {
            storeSecret: vi.fn(),
            retrieveSecret: vi.fn(),
            deleteSecret: vi.fn(),
            listSecretKeys: vi.fn(),
            hasSecret: vi.fn(),
            getRedactor: vi.fn().mockResolvedValue(mockRedactor),
          };
        }
        return undefined;
      }),
      offer: (caps: any) => {
        offeredCapabilities['user-files'] = caps;
      },
      config: vi.fn().mockResolvedValue({
        getPluginConfig: () => configValues,
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
    }),
  };
}

function parseToolJson(raw: string): any {
  return JSON.parse(raw);
}

describe('userFilesPlugin', () => {
  let tmpDir: string;
  let mockInterface: ReturnType<typeof createMockPluginInterface>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-user-files-'));

    fs.mkdirSync(path.join(tmpDir, 'docs'));
    fs.mkdirSync(path.join(tmpDir, '.hidden-dir'));
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'hello notes', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'report.md'), '# report', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '.secret.txt'), 'secret', 'utf-8');
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'nested.txt'),
      'nested',
      'utf-8'
    );

    mockInterface = createMockPluginInterface({
      allowedFilePaths: [tmpDir],
      allowedFileTypesReadOnly: ['.txt', '.md', '.json', '.log'],
      allowedFileTypesWrite: ['.txt', '.md'],
      maxFileSizeBytes: 10485760,
    });

    await userFilesPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has correct plugin metadata', () => {
    expect(userFilesPlugin.pluginMetadata).toMatchObject({
      id: 'user-files',
      name: 'User Files Plugin',
      version: 'LATEST',
      required: false,
    });
    expect(userFilesPlugin.pluginMetadata.dependencies).toEqual([
      { id: 'credential-store', version: 'LATEST' },
    ]);
  });

  it('registers the expected tool names', () => {
    const toolNames = mockInterface.registeredTools.map(tool => tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'findUserFiles',
        'getDirectoryListing',
        'readUserTextFile',
        'writeUserTextFile',
      ])
    );
    expect(toolNames).not.toContain('previewUserTextFile');
  });

  it('offers user-files capabilities and returns config-backed values', async () => {
    const api = mockInterface.offeredCapabilities['user-files'];
    expect(api).toBeDefined();

    await expect(api.getAllowedFilePaths()).resolves.toEqual([tmpDir]);
    await expect(api.getAllowedFileTypesForReadOnly()).resolves.toEqual([
      '.txt',
      '.md',
      '.json',
      '.log',
    ]);
    await expect(api.getAllowedFileTypesForWrite()).resolves.toEqual([
      '.txt',
      '.md',
    ]);
  });

  it('getPossibleFileTypes reports unique file types from registered handlers', async () => {
    const api = mockInterface.offeredCapabilities['user-files'];

    await api.registerFileTypeTextHandler(['.txt', '.md'], async () => 'x');
    await api.registerFileTypeVisionHandler(
      ['.png', '.jpg', '.txt'],
      async () => Buffer.from('img')
    );

    const types = await api.getPossibleFileTypes();
    expect(types).toEqual(
      expect.arrayContaining(['.txt', '.md', '.png', '.jpg'])
    );
    expect(types.filter((t: string) => t === '.txt')).toHaveLength(1);
  });

  it('getDirectoryListing lists folders/files, excludes hidden entries, and sorts folders first', async () => {
    const tool = mockInterface.registeredTools.find(
      toolDef => toolDef.name === 'getDirectoryListing'
    )!;

    const result = parseToolJson(await tool.execute({ path: tmpDir }));

    expect(result.error).toBeUndefined();
    expect(
      result.items.find((i: any) => i.name === '.secret.txt')
    ).toBeUndefined();
    expect(
      result.items.find((i: any) => i.name === '.hidden-dir')
    ).toBeUndefined();

    const docsIndex = result.items.findIndex((i: any) => i.name === 'docs');
    const notesIndex = result.items.findIndex(
      (i: any) => i.name === 'notes.txt'
    );
    expect(docsIndex).toBeGreaterThanOrEqual(0);
    expect(notesIndex).toBeGreaterThanOrEqual(0);
    expect(docsIndex).toBeLessThan(notesIndex);
  });

  it('getDirectoryListing supports filter with wildcard and substring', async () => {
    const tool = mockInterface.registeredTools.find(
      toolDef => toolDef.name === 'getDirectoryListing'
    )!;

    const wildcardResult = parseToolJson(
      await tool.execute({ path: tmpDir, filter: '*.txt' })
    );
    expect(
      wildcardResult.items.every((i: any) => i.name.endsWith('.txt'))
    ).toBe(true);

    const substringResult = parseToolJson(
      await tool.execute({ path: tmpDir, filter: 'rep' })
    );
    expect(substringResult.items).toEqual([
      expect.objectContaining({ name: 'report.md' }),
    ]);
  });

  it('getDirectoryListing blocks paths outside allowedFilePaths', async () => {
    const tool = mockInterface.registeredTools.find(
      toolDef => toolDef.name === 'getDirectoryListing'
    )!;

    const result = parseToolJson(await tool.execute({ path: '/tmp' }));
    expect(result.error).toMatch(/outside allowed file paths/i);
  });

  it('readUserTextFile returns file content with offset and maxBytes controls', async () => {
    const tool = mockInterface.registeredTools.find(
      toolDef => toolDef.name === 'readUserTextFile'
    )!;

    const result = parseToolJson(
      await tool.execute({
        path: path.join(tmpDir, 'notes.txt'),
        offset: 6,
        maxBytes: 5,
      })
    );

    expect(result.error).toBeUndefined();
    expect(result.offset).toBe(6);
    expect(result.bytesRead).toBe(5);
    expect(result.message).toMatch(/Complete file contents/i);
  });

  it('readUserTextFile rejects offsets beyond EOF', async () => {
    const tool = mockInterface.registeredTools.find(
      toolDef => toolDef.name === 'readUserTextFile'
    )!;

    const result = parseToolJson(
      await tool.execute({
        path: path.join(tmpDir, 'notes.txt'),
        offset: 9999,
      })
    );

    expect(result.error).toMatch(/beyond end of file/i);
  });

  it('writeUserTextFile writes file contents and returns metadata', async () => {
    const tool = mockInterface.registeredTools.find(
      toolDef => toolDef.name === 'writeUserTextFile'
    )!;

    const targetPath = path.join(tmpDir, 'new-note.txt');
    const result = parseToolJson(
      await tool.execute({ path: targetPath, contents: 'hello world' })
    );

    expect(result.error).toBeUndefined();
    expect(result.charsWritten).toBe(11);
    expect(fs.readFileSync(targetPath, 'utf-8')).toBe('hello world');
  });

  it('writeUserTextFile blocks file types outside allowedFileTypesWrite', async () => {
    const tool = mockInterface.registeredTools.find(
      toolDef => toolDef.name === 'writeUserTextFile'
    )!;

    const result = parseToolJson(
      await tool.execute({
        path: path.join(tmpDir, 'blocked.json'),
        contents: '{}',
      })
    );

    expect(result.error).toMatch(/File type not allowed for writing/i);
  });

  it('writeUserTextFile blocks writes to hidden files/directories', async () => {
    const tool = mockInterface.registeredTools.find(
      toolDef => toolDef.name === 'writeUserTextFile'
    )!;

    const hiddenFileResult = parseToolJson(
      await tool.execute({
        path: path.join(tmpDir, '.hidden.txt'),
        contents: 'x',
      })
    );
    expect(hiddenFileResult.error).toMatch(/hidden files/i);

    const hiddenDirResult = parseToolJson(
      await tool.execute({
        path: path.join(tmpDir, '.hidden-dir', 'a.txt'),
        contents: 'x',
      })
    );
    expect(hiddenDirResult.error).toMatch(/hidden files/i);
  });

  it('writeUserTextFile creates parent directories recursively', async () => {
    const tool = mockInterface.registeredTools.find(
      toolDef => toolDef.name === 'writeUserTextFile'
    )!;

    const nestedTarget = path.join(tmpDir, 'new', 'deep', 'file.txt');
    const result = parseToolJson(
      await tool.execute({ path: nestedTarget, contents: 'nested write' })
    );

    expect(result.error).toBeUndefined();
    expect(fs.existsSync(nestedTarget)).toBe(true);
    expect(fs.readFileSync(nestedTarget, 'utf-8')).toBe('nested write');
  });

  it('findUserFiles returns files matching name pattern within allowed roots', async () => {
    const tool = mockInterface.registeredTools.find(
      toolDef => toolDef.name === 'findUserFiles'
    )!;

    const result = parseToolJson(
      await tool.execute({ namePattern: '*.txt', limit: 20 })
    );

    expect(result.error).toBeUndefined();
    expect(result.resultCount).toBeGreaterThanOrEqual(2);
    expect(
      result.results.some((r: any) =>
        r.path.endsWith(path.join('docs', 'nested.txt'))
      )
    ).toBe(true);
  });
});
