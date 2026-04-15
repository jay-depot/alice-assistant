/**
 * @file gmail.test.ts
 *
 * Unit tests for the gmail provider plugin.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';

// Mock the plugin-hooks module to break circular dependencies
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

// Mock external Google APIs
vi.mock('@googleapis/gmail', () => ({
  gmail: vi.fn(),
}));
vi.mock('google-auth-library', () => {
  class MockOAuth2Client {
    setCredentials = vi.fn();
    generateAuthUrl = vi
      .fn()
      .mockReturnValue('https://accounts.google.com/oauth');
    getToken = vi.fn().mockResolvedValue({
      tokens: { access_token: 'mock', refresh_token: 'mock_refresh' },
    });
    revokeToken = vi.fn().mockResolvedValue(undefined);
    getAccessToken = vi.fn().mockResolvedValue({ token: 'mock_access' });
    on = vi.fn();
  }
  return { OAuth2Client: MockOAuth2Client };
});

import type { AlicePluginInterface } from '../../../lib.js';
import gmailPlugin from './gmail.js';

function createMockPluginInterface(
  googleApisCapability: Record<string, any> | null,
  emailBrokerCapability: Record<string, any> | null
) {
  let capturedAllPluginsLoaded: (() => Promise<void>) | null = null;
  const mockLogger = {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    mockLogger,
    getCapturedHook: () => capturedAllPluginsLoaded,
    registerPlugin: async () => ({
      logger: mockLogger,
      registerTool: vi.fn(),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      hooks: {
        onAllPluginsLoaded: vi.fn((cb: () => Promise<void>) => {
          capturedAllPluginsLoaded = cb;
        }),
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
      config: vi.fn().mockResolvedValue({
        getPluginConfig: () => ({ maxResultsPerSearch: 10 }),
      }),
      offer: vi.fn(),
      request: vi.fn((capabilityId: string) => {
        if (capabilityId === 'google-apis') return googleApisCapability;
        if (capabilityId === 'email-broker') return emailBrokerCapability;
        return null;
      }),
    }),
  };
}

describe('gmailPlugin', () => {
  describe('plugin metadata', () => {
    it('should have the correct plugin metadata', () => {
      expect(gmailPlugin.pluginMetadata.id).toBe('gmail');
      expect(gmailPlugin.pluginMetadata.name).toBe('Gmail Plugin');
      expect(gmailPlugin.pluginMetadata.required).toBe(false);
      expect(gmailPlugin.pluginMetadata.dependencies).toEqual([
        { id: 'google-apis', version: 'LATEST' },
        { id: 'email-broker', version: 'LATEST' },
      ]);
    });
  });

  describe('provider registration', () => {
    it('should register as an email provider when google-apis has an authenticated account', async () => {
      const mockGmailClient = {
        users: { messages: { list: vi.fn(), get: vi.fn(), send: vi.fn() } },
      };

      const googleApisCapability = {
        listAccounts: vi.fn().mockReturnValue(['personal']),
        getAccountInfo: vi.fn().mockReturnValue({
          accountId: 'personal',
          email: 'test@gmail.com',
          isAuthenticated: true,
        }),
        getGmailClient: vi.fn().mockResolvedValue(mockGmailClient),
      };

      const emailBrokerCapability = {
        registerEmailProvider: vi.fn(),
      };

      const mockInterface = createMockPluginInterface(
        googleApisCapability,
        emailBrokerCapability
      );
      await gmailPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      // Trigger onAllPluginsLoaded
      const hook = mockInterface.getCapturedHook();
      expect(hook).toBeDefined();
      await hook!();

      expect(emailBrokerCapability.registerEmailProvider).toHaveBeenCalledWith(
        'gmail:personal',
        expect.objectContaining({
          searchEmails: expect.any(Function),
          readEmail: expect.any(Function),
          sendEmail: expect.any(Function),
        })
      );
    });

    it('should skip unauthenticated accounts', async () => {
      const googleApisCapability = {
        listAccounts: vi.fn().mockReturnValue(['personal', 'work']),
        getAccountInfo: vi.fn().mockImplementation((id: string) => {
          if (id === 'personal')
            return { accountId: 'personal', isAuthenticated: true };
          return { accountId: 'work', isAuthenticated: false };
        }),
        getGmailClient: vi.fn().mockResolvedValue({}),
      };

      const emailBrokerCapability = {
        registerEmailProvider: vi.fn(),
      };

      const mockInterface = createMockPluginInterface(
        googleApisCapability,
        emailBrokerCapability
      );
      await gmailPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      await mockInterface.getCapturedHook()!();

      // Only the authenticated account should be registered
      expect(emailBrokerCapability.registerEmailProvider).toHaveBeenCalledTimes(
        1
      );
      expect(emailBrokerCapability.registerEmailProvider).toHaveBeenCalledWith(
        'gmail:personal',
        expect.any(Object)
      );
    });

    it('should warn when no Google accounts are connected', async () => {
      const googleApisCapability = {
        listAccounts: vi.fn().mockReturnValue([]),
      };

      const emailBrokerCapability = {
        registerEmailProvider: vi.fn(),
      };

      const mockInterface = createMockPluginInterface(
        googleApisCapability,
        emailBrokerCapability
      );
      await gmailPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      await mockInterface.getCapturedHook()!();

      expect(
        emailBrokerCapability.registerEmailProvider
      ).not.toHaveBeenCalled();
      expect(mockInterface.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No Google accounts')
      );
    });

    it('should error when google-apis capability is not available', async () => {
      const emailBrokerCapability = {
        registerEmailProvider: vi.fn(),
      };

      const mockInterface = createMockPluginInterface(
        null,
        emailBrokerCapability
      );
      await gmailPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      expect(mockInterface.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('google-apis capability not available')
      );
    });

    it('should error when email-broker capability is not available', async () => {
      const googleApisCapability = {
        listAccounts: vi.fn().mockReturnValue([]),
      };

      const mockInterface = createMockPluginInterface(
        googleApisCapability,
        null
      );
      await gmailPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      expect(mockInterface.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('email-broker capability not available')
      );
    });

    it('should register separate providers for each authenticated account', async () => {
      const googleApisCapability = {
        listAccounts: vi.fn().mockReturnValue(['personal', 'work']),
        getAccountInfo: vi.fn().mockImplementation((id: string) => ({
          accountId: id,
          email: `${id}@gmail.com`,
          isAuthenticated: true,
        })),
        getGmailClient: vi.fn().mockResolvedValue({}),
      };

      const emailBrokerCapability = {
        registerEmailProvider: vi.fn(),
      };

      const mockInterface = createMockPluginInterface(
        googleApisCapability,
        emailBrokerCapability
      );
      await gmailPlugin.registerPlugin(
        mockInterface as unknown as AlicePluginInterface
      );

      await mockInterface.getCapturedHook()!();

      expect(emailBrokerCapability.registerEmailProvider).toHaveBeenCalledTimes(
        2
      );
      expect(emailBrokerCapability.registerEmailProvider).toHaveBeenCalledWith(
        'gmail:personal',
        expect.any(Object)
      );
      expect(emailBrokerCapability.registerEmailProvider).toHaveBeenCalledWith(
        'gmail:work',
        expect.any(Object)
      );
    });
  });
});
