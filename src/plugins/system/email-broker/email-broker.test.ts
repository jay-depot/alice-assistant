/**
 * @file email-broker.test.ts
 *
 * Unit tests for the email-broker plugin.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Break circular dep chain via plugin-hooks
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
import emailBrokerPlugin from './email-broker.js';

function createMockPluginInterface(defaultProvider?: string) {
  const offeredCapabilities: Record<string, any> = {};
  const registeredTools: any[] = [];
  const mockLogger = {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    offeredCapabilities,
    registeredTools,
    mockLogger,
    registerPlugin: async () => ({
      logger: mockLogger,
      registerTool: (tool: any) => registeredTools.push(tool),
      registerHeaderSystemPrompt: vi.fn(),
      registerFooterSystemPrompt: vi.fn(),
      registerConversationType: vi.fn(),
      registerTaskAssistant: vi.fn(),
      addToolToConversationType: vi.fn(),
      request: vi.fn(),
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
      offer: (caps: any) => {
        offeredCapabilities['email-broker'] = caps;
      },
      config: vi.fn().mockResolvedValue({
        getPluginConfig: () => ({ defaultProvider }),
      }),
    }),
  };
}

type EmailApi = {
  registerEmailProvider: (name: string, provider: any) => void;
  requestEmailSearch: (params: any) => Promise<Record<string, any[]>>;
  requestEmailRead: (params: any) => Promise<Record<string, any>>;
  requestEmailSend: (params: any) => Promise<Record<string, any>>;
};

describe('emailBrokerPlugin', () => {
  let mockInterface: ReturnType<typeof createMockPluginInterface>;
  let api: EmailApi;

  beforeEach(async () => {
    mockInterface = createMockPluginInterface();
    await emailBrokerPlugin.registerPlugin(
      mockInterface as unknown as AlicePluginInterface
    );
    api = mockInterface.offeredCapabilities['email-broker'];
  });

  it('has correct plugin metadata', () => {
    expect(emailBrokerPlugin.pluginMetadata).toMatchObject({
      id: 'email-broker',
      name: 'Email Broker Plugin',
      version: 'LATEST',
      required: false,
    });
  });

  it('offers registerEmailProvider, requestEmailSearch, requestEmailRead, requestEmailSend', () => {
    expect(typeof api.registerEmailProvider).toBe('function');
    expect(typeof api.requestEmailSearch).toBe('function');
    expect(typeof api.requestEmailRead).toBe('function');
    expect(typeof api.requestEmailSend).toBe('function');
  });

  it('registers searchEmail, readEmail, and sendEmail tools', () => {
    const toolNames = mockInterface.registeredTools.map((t: any) => t.name);
    expect(toolNames).toContain('searchEmail');
    expect(toolNames).toContain('readEmail');
    expect(toolNames).toContain('sendEmail');
  });

  it('all tools have tainted status', () => {
    for (const tool of mockInterface.registeredTools) {
      expect(tool.taintStatus).toBe('tainted');
    }
  });

  it('all tools are available for chat, voice, and autonomy', () => {
    for (const tool of mockInterface.registeredTools) {
      expect(tool.availableFor).toContain('chat');
      expect(tool.availableFor).toContain('voice');
      expect(tool.availableFor).toContain('autonomy');
    }
  });

  it('sendEmail tool has user-confirmation instruction in systemPromptFragment', () => {
    const sendTool = mockInterface.registeredTools.find(
      (t: any) => t.name === 'sendEmail'
    );
    expect(sendTool).toBeDefined();
    expect(sendTool!.systemPromptFragment).toContain('NEVER send an email');
    expect(sendTool!.systemPromptFragment).toContain('confirm');
  });

  describe('requestEmailSearch', () => {
    it('returns empty object when no providers registered', async () => {
      const result = await api.requestEmailSearch({ query: 'test' });
      expect(result).toEqual({});
    });

    it('calls all providers and merges results', async () => {
      const provider1 = {
        searchEmails: vi.fn().mockResolvedValue([
          {
            id: '1',
            subject: 'Test 1',
            from: 'a@b.com',
            to: ['c@d.com'],
            body: 'body',
            date: '2024-01-01',
            hasAttachments: false,
          },
        ]),
        readEmail: vi.fn(),
        sendEmail: vi.fn(),
      };
      const provider2 = {
        searchEmails: vi.fn().mockResolvedValue([
          {
            id: '2',
            subject: 'Test 2',
            from: 'e@f.com',
            to: ['g@h.com'],
            body: 'body2',
            date: '2024-01-02',
            hasAttachments: false,
          },
        ]),
        readEmail: vi.fn(),
        sendEmail: vi.fn(),
      };

      api.registerEmailProvider('prov1', provider1);
      api.registerEmailProvider('prov2', provider2);

      const result = await api.requestEmailSearch({
        query: 'test',
        maxResults: 10,
      });

      expect(provider1.searchEmails).toHaveBeenCalledWith({
        query: 'test',
        maxResults: 10,
      });
      expect(provider2.searchEmails).toHaveBeenCalledWith({
        query: 'test',
        maxResults: 10,
      });
      expect(Object.keys(result)).toContain('prov1');
      expect(Object.keys(result)).toContain('prov2');
    });

    it('gracefully handles provider failures', async () => {
      const provider1 = {
        searchEmails: vi.fn().mockRejectedValue(new Error('API error')),
        readEmail: vi.fn(),
        sendEmail: vi.fn(),
      };
      const provider2 = {
        searchEmails: vi.fn().mockResolvedValue([
          {
            id: '2',
            subject: 'Test 2',
            from: 'e@f.com',
            to: ['g@h.com'],
            body: 'body2',
            date: '2024-01-02',
            hasAttachments: false,
          },
        ]),
        readEmail: vi.fn(),
        sendEmail: vi.fn(),
      };

      api.registerEmailProvider('fail-prov', provider1);
      api.registerEmailProvider('ok-prov', provider2);

      const result = await api.requestEmailSearch({ query: 'test' });
      expect(Object.keys(result)).not.toContain('fail-prov');
      expect(Object.keys(result)).toContain('ok-prov');
    });
  });

  describe('requestEmailRead', () => {
    it('returns empty object when no providers registered', async () => {
      const result = await api.requestEmailRead({ messageId: '123' });
      expect(result).toEqual({});
    });

    it('returns results from providers that found the message', async () => {
      const message = {
        id: '1',
        subject: 'Test',
        from: 'a@b.com',
        to: ['c@d.com'],
        body: 'Hello',
        date: '2024-01-01',
        hasAttachments: false,
      };

      const provider1 = {
        searchEmails: vi.fn(),
        readEmail: vi.fn().mockResolvedValue(message),
        sendEmail: vi.fn(),
      };
      const provider2 = {
        searchEmails: vi.fn(),
        readEmail: vi.fn().mockResolvedValue(null),
        sendEmail: vi.fn(),
      };

      api.registerEmailProvider('prov1', provider1);
      api.registerEmailProvider('prov2', provider2);

      const result = await api.requestEmailRead({ messageId: '1' });
      expect(result['prov1']).toEqual(message);
      expect(Object.keys(result)).not.toContain('prov2');
    });
  });

  describe('requestEmailSend', () => {
    it('returns empty object when no providers registered', async () => {
      const result = await api.requestEmailSend({
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Hello',
      });
      expect(result).toEqual({});
    });

    it('sends via the first provider when no provider is specified', async () => {
      const provider1 = {
        searchEmails: vi.fn(),
        readEmail: vi.fn(),
        sendEmail: vi.fn().mockResolvedValue({
          provider: 'prov1',
          success: true,
          message: 'Sent',
          messageId: 'msg1',
        }),
      };

      api.registerEmailProvider('prov1', provider1);

      const result = await api.requestEmailSend({
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Hello',
      });

      expect(provider1.sendEmail).toHaveBeenCalledWith({
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Hello',
      });
      expect(result['prov1']).toBeDefined();
      expect(result['prov1'].success).toBe(true);
    });

    it('sends via the specified provider', async () => {
      const provider1 = {
        searchEmails: vi.fn(),
        readEmail: vi.fn(),
        sendEmail: vi.fn().mockResolvedValue({
          provider: 'gmail:personal',
          success: true,
          message: 'Sent',
        }),
      };
      const provider2 = {
        searchEmails: vi.fn(),
        readEmail: vi.fn(),
        sendEmail: vi.fn().mockResolvedValue({
          provider: 'gmail:work',
          success: true,
          message: 'Sent',
        }),
      };

      api.registerEmailProvider('gmail:personal', provider1);
      api.registerEmailProvider('gmail:work', provider2);

      const result = await api.requestEmailSend({
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Hello',
        provider: 'gmail:work',
      });

      expect(provider2.sendEmail).toHaveBeenCalled();
      expect(result['gmail:work']).toBeDefined();
    });

    it('falls back to the first provider if specified provider does not exist', async () => {
      const provider1 = {
        searchEmails: vi.fn(),
        readEmail: vi.fn(),
        sendEmail: vi.fn().mockResolvedValue({
          provider: 'prov1',
          success: true,
          message: 'Sent',
        }),
      };

      api.registerEmailProvider('prov1', provider1);

      const result = await api.requestEmailSend({
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Hello',
        provider: 'nonexistent',
      });

      expect(provider1.sendEmail).toHaveBeenCalled();
      expect(result['prov1']).toBeDefined();
    });
  });

  describe('LLM tool execution', () => {
    describe('searchEmail tool', () => {
      it('returns no-providers message when no providers registered', async () => {
        const searchTool = mockInterface.registeredTools.find(
          (t: any) => t.name === 'searchEmail'
        );
        const result = await searchTool.execute({ query: 'test' });
        expect(result).toContain('No email providers');
      });

      it('formats results from providers', async () => {
        const provider = {
          searchEmails: vi.fn().mockResolvedValue([
            {
              id: '1',
              subject: 'Hello',
              from: 'a@b.com',
              to: ['c@d.com'],
              body: 'body text here',
              date: '2024-01-01',
              hasAttachments: false,
              labels: ['INBOX', 'UNREAD'],
            },
          ]),
          readEmail: vi.fn(),
          sendEmail: vi.fn(),
        };
        api.registerEmailProvider('gmail:personal', provider);

        const searchTool = mockInterface.registeredTools.find(
          (t: any) => t.name === 'searchEmail'
        );
        const result = await searchTool.execute({ query: 'hello' });

        expect(result).toContain('gmail:personal');
        expect(result).toContain('Hello');
        expect(result).toContain('a@b.com');
      });
    });

    describe('readEmail tool', () => {
      it('returns no-providers message when no providers registered', async () => {
        const readTool = mockInterface.registeredTools.find(
          (t: any) => t.name === 'readEmail'
        );
        const result = await readTool.execute({ messageId: '123' });
        expect(result).toContain('No email providers');
      });

      it('formats email content from provider', async () => {
        const provider = {
          searchEmails: vi.fn(),
          readEmail: vi.fn().mockResolvedValue({
            id: '1',
            threadId: 't1',
            subject: 'Test Subject',
            from: 'sender@test.com',
            to: ['recipient@test.com'],
            cc: ['cc@test.com'],
            body: 'Hello world',
            date: '2024-01-01T12:00:00Z',
            labels: ['INBOX'],
            hasAttachments: true,
            attachmentNames: ['doc.pdf'],
          }),
          sendEmail: vi.fn(),
        };
        api.registerEmailProvider('gmail:personal', provider);

        const readTool = mockInterface.registeredTools.find(
          (t: any) => t.name === 'readEmail'
        );
        const result = await readTool.execute({ messageId: '1' });

        expect(result).toContain('gmail:personal');
        expect(result).toContain('Test Subject');
        expect(result).toContain('sender@test.com');
        expect(result).toContain('Hello world');
        expect(result).toContain('INBOX');
        expect(result).toContain('doc.pdf');
      });
    });

    describe('sendEmail tool', () => {
      it('returns no-providers message when no providers registered', async () => {
        const sendTool = mockInterface.registeredTools.find(
          (t: any) => t.name === 'sendEmail'
        );
        const result = await sendTool.execute({
          to: ['test@test.com'],
          subject: 'Test',
          body: 'Hello',
        });
        expect(result).toContain('No email providers');
      });

      it('sends email and returns confirmation', async () => {
        const provider = {
          searchEmails: vi.fn(),
          readEmail: vi.fn(),
          sendEmail: vi.fn().mockResolvedValue({
            provider: 'gmail:personal',
            success: true,
            message: 'Email sent',
            messageId: 'msg123',
          }),
        };
        api.registerEmailProvider('gmail:personal', provider);

        const sendTool = mockInterface.registeredTools.find(
          (t: any) => t.name === 'sendEmail'
        );
        const result = await sendTool.execute({
          to: ['test@test.com'],
          subject: 'Test Subject',
          body: 'Hello body',
        });

        expect(result).toContain('sent successfully');
        expect(result).toContain('gmail:personal');
        expect(result).toContain('Test Subject');
      });
    });
  });

  describe('registerEmailProvider with same name overrides previous', () => {
    it('should replace the previous provider when registering with the same name', async () => {
      const first = {
        searchEmails: vi.fn().mockResolvedValue([
          {
            id: 'old',
            subject: 'Old',
            from: 'a@b.com',
            to: ['c@d.com'],
            body: 'old',
            date: '2024-01-01',
            hasAttachments: false,
          },
        ]),
        readEmail: vi.fn(),
        sendEmail: vi.fn(),
      };
      const second = {
        searchEmails: vi.fn().mockResolvedValue([
          {
            id: 'new',
            subject: 'New',
            from: 'e@f.com',
            to: ['g@h.com'],
            body: 'new',
            date: '2024-01-02',
            hasAttachments: false,
          },
        ]),
        readEmail: vi.fn(),
        sendEmail: vi.fn(),
      };

      api.registerEmailProvider('same', first);
      api.registerEmailProvider('same', second);

      const result = await api.requestEmailSearch({ query: 'test' });
      expect(first.searchEmails).not.toHaveBeenCalled();
      expect(second.searchEmails).toHaveBeenCalledOnce();
      expect(result['same'][0].subject).toBe('New');
    });
  });
});
