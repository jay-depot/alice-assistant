/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApp, mockExpress, mockExpressJson, mockServerClose, mockListen } =
  vi.hoisted(() => {
    const serverClose = vi.fn((callback?: (err?: Error) => void) => {
      callback?.();
    });
    const listen = vi.fn(() => ({ close: serverClose }));
    const app = {
      use: vi.fn(),
      listen,
    };

    return {
      mockApp: app,
      mockExpress: vi.fn(() => app),
      mockExpressJson: vi.fn(() => 'json-middleware'),
      mockServerClose: serverClose,
      mockListen: listen,
    };
  });

vi.mock('express', () => {
  const expressExport = Object.assign(mockExpress, {
    json: mockExpressJson,
  });

  return {
    default: expressExport,
  };
});

vi.mock('../../../lib/user-config.js', () => ({
  UserConfig: {
    getConfig: () => ({
      webInterface: {
        port: 47153,
        bindToAddress: '127.0.0.1',
      },
    }),
  },
}));

import type { AlicePluginInterface } from '../../../lib.js';
import restServePlugin from './rest-serve.js';

function createMockPluginInterface() {
  const offeredCapabilities: Record<string, any> = {};
  const hookCallbacks: Record<string, Array<() => Promise<void>>> = {
    onAssistantAcceptsRequests: [],
    onAssistantWillStopAcceptingRequests: [],
  };

  return {
    offeredCapabilities,
    runHook: async (hookName: string) => {
      for (const callback of hookCallbacks[hookName] ?? []) {
        await callback();
      }
    },
    registerPlugin: async () => ({
      registerTool: vi.fn(),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      config: vi.fn(),
      hooks: {
        onAllPluginsLoaded: vi.fn(),
        onAssistantWillAcceptRequests: vi.fn(),
        onAssistantAcceptsRequests: (cb: () => Promise<void>) => {
          hookCallbacks.onAssistantAcceptsRequests.push(cb);
        },
        onAssistantWillStopAcceptingRequests: (cb: () => Promise<void>) => {
          hookCallbacks.onAssistantWillStopAcceptingRequests.push(cb);
        },
        onAssistantStoppedAcceptingRequests: vi.fn(),
        onPluginsWillUnload: vi.fn(),
        onTaskAssistantWillBegin: vi.fn(),
        onTaskAssistantWillEnd: vi.fn(),
        onUserConversationWillBegin: vi.fn(),
        onUserConversationWillEnd: vi.fn(),
        onContextCompactionSummariesWillBeDeleted: vi.fn(),
      },
      offer: (caps: any) => {
        offeredCapabilities['rest-serve'] = caps;
      },
      request: vi.fn(() => undefined),
    }),
  };
}

describe('restServePlugin', () => {
  beforeEach(() => {
    mockExpress.mockClear();
    mockExpressJson.mockClear();
    mockApp.use.mockClear();
    mockListen.mockClear();
    mockServerClose.mockClear();
  });

  it('has correct plugin metadata', () => {
    expect(restServePlugin.pluginMetadata).toMatchObject({
      id: 'rest-serve',
      name: 'REST Serve',
      version: 'LATEST',
      required: true,
    });
  });

  it('offers Express capability and installs json middleware', async () => {
    const mockInterface = createMockPluginInterface();
    await restServePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    const api = mockInterface.offeredCapabilities['rest-serve'];
    expect(api.express).toBe(mockApp);
    expect(mockApp.use).toHaveBeenCalledWith('json-middleware');
  });

  it('starts listening when assistant accepts requests', async () => {
    const mockInterface = createMockPluginInterface();
    await restServePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    await mockInterface.runHook('onAssistantAcceptsRequests');

    expect(mockListen).toHaveBeenCalledWith(
      47153,
      '127.0.0.1',
      expect.any(Function)
    );
  });

  it('closes server on shutdown after startup', async () => {
    const mockInterface = createMockPluginInterface();
    await restServePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    await mockInterface.runHook('onAssistantAcceptsRequests');
    await mockInterface.runHook('onAssistantWillStopAcceptingRequests');

    expect(mockServerClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing on shutdown if server never started', async () => {
    const mockInterface = createMockPluginInterface();
    await restServePlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );

    await mockInterface.runHook('onAssistantWillStopAcceptingRequests');

    expect(mockServerClose).not.toHaveBeenCalled();
  });
});
