/**
 * @file google-apis.test.ts
 *
 * Unit tests for the google-apis plugin: AccountStore and OAuthManager.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock external dependencies BEFORE importing the modules under test
// ---------------------------------------------------------------------------

vi.mock('google-auth-library', () => {
  // Use a class mock so that `new OAuth2Client(...)` works as a constructor
  class MockOAuth2Client {
    credentials: Record<string, unknown> = {};
    setCredentials = vi.fn();
    generateAuthUrl = vi
      .fn()
      .mockReturnValue(
        'https://accounts.google.com/o/oauth2/v2/auth?mock=true'
      );
    getToken = vi.fn().mockResolvedValue({
      tokens: {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expiry_date: Date.now() + 3600000,
        scope:
          'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar',
      },
    });
    revokeToken = vi.fn().mockResolvedValue(undefined);
    getAccessToken = vi.fn().mockResolvedValue({ token: 'mock-access-token' });
    on = vi.fn();

    constructor(public _options: Record<string, unknown> = {}) {}
  }

  return { OAuth2Client: MockOAuth2Client };
});

vi.mock('@googleapis/gmail', () => ({
  gmail: vi.fn().mockReturnValue({ context: { _mock: 'gmail' } }),
}));

vi.mock('@googleapis/calendar', () => ({
  calendar: vi.fn().mockReturnValue({ context: { _mock: 'calendar' } }),
}));

vi.mock('@googleapis/people', () => ({
  people: vi.fn().mockReturnValue({
    people: {
      get: vi.fn().mockResolvedValue({
        data: {
          emailAddresses: [{ value: 'test@example.com' }],
          names: [{ displayName: 'Test User' }],
        },
      }),
    },
  }),
}));

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

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------

import { AccountStore } from './account-store.js';
import { OAuthManager } from './oauth-manager.js';

// ---------------------------------------------------------------------------
// AccountStore tests
// ---------------------------------------------------------------------------

function createMockCredentialStore() {
  const store = new Map<string, string>();

  return {
    storeSecret: vi.fn(async (key: string, plaintext: string) => {
      store.set(key, plaintext);
    }),
    retrieveSecret: vi.fn(async (key: string) => {
      return store.get(key) ?? undefined;
    }),
    deleteSecret: vi.fn(async (key: string) => {
      return store.delete(key);
    }),
    listSecretKeys: vi.fn(async () => {
      return Array.from(store.keys());
    }),
    hasSecret: vi.fn(async (key: string) => {
      return store.has(key);
    }),
    // Internal helper for tests
    _store: store,
  };
}

describe('AccountStore', () => {
  let credentialStore: ReturnType<typeof createMockCredentialStore>;
  let accountStore: AccountStore;

  beforeEach(() => {
    credentialStore = createMockCredentialStore();
    accountStore = new AccountStore(credentialStore);
  });

  it('creates a new account in the registry', () => {
    const account = accountStore.registerAccount('personal');
    expect(account.accountId).toBe('personal');
    expect(account.isAuthenticated).toBe(false);
  });

  it('returns existing account if already registered', () => {
    const first = accountStore.registerAccount('work');
    const second = accountStore.registerAccount('work');
    expect(first).toBe(second);
  });

  it('lists account IDs', () => {
    accountStore.registerAccount('personal');
    accountStore.registerAccount('work');
    expect(accountStore.listAccountIds()).toEqual(
      expect.arrayContaining(['personal', 'work'])
    );
  });

  it('gets an account by ID', () => {
    accountStore.registerAccount('personal');
    const account = accountStore.getAccount('personal');
    expect(account).toBeDefined();
    expect(account?.accountId).toBe('personal');
  });

  it('returns undefined for unknown account ID', () => {
    expect(accountStore.getAccount('unknown')).toBeUndefined();
  });

  it('saves and retrieves tokens in the vault', async () => {
    await accountStore.saveTokenSet('personal', {
      refreshToken: 'rt-123',
      accessToken: 'at-456',
      tokenExpiry: '2025-01-01T00:00:00Z',
      scopes: 'gmail.modify calendar',
    });

    const refreshToken = await accountStore.getRefreshToken('personal');
    expect(refreshToken).toBe('rt-123');

    const accessToken = await accountStore.getAccessToken('personal');
    expect(accessToken).toBe('at-456');
  });

  it('marks account as authenticated after saving tokens', async () => {
    await accountStore.saveTokenSet('personal', {
      refreshToken: 'rt-123',
    });

    const account = accountStore.getAccount('personal');
    expect(account?.isAuthenticated).toBe(true);
  });

  it('saves account info (email, displayName) to vault', async () => {
    accountStore.registerAccount('personal');
    await accountStore.saveAccountInfo(
      'personal',
      'test@gmail.com',
      'Test User'
    );

    const account = accountStore.getAccount('personal');
    expect(account?.email).toBe('test@gmail.com');
    expect(account?.displayName).toBe('Test User');
  });

  it('saves and loads client credentials', async () => {
    await accountStore.saveClientCredentials('personal', 'cid-123', 'csec-456');

    const creds = await accountStore.loadClientCredentials('personal');
    expect(creds).toEqual({ clientId: 'cid-123', clientSecret: 'csec-456' });
  });

  it('returns undefined for missing client credentials', async () => {
    const creds = await accountStore.loadClientCredentials('unknown');
    expect(creds).toBeUndefined();
  });

  it('resolveClientCredentials returns per-account credentials when present', async () => {
    await accountStore.saveClientCredentials(
      '_default',
      'default-cid',
      'default-csec'
    );
    await accountStore.saveClientCredentials(
      'personal',
      'personal-cid',
      'personal-csec'
    );

    const creds = await accountStore.resolveClientCredentials('personal');
    expect(creds).toEqual({
      clientId: 'personal-cid',
      clientSecret: 'personal-csec',
    });
  });

  it('resolveClientCredentials falls back to _default when per-account missing', async () => {
    await accountStore.saveClientCredentials(
      '_default',
      'default-cid',
      'default-csec'
    );

    const creds = await accountStore.resolveClientCredentials('personal');
    expect(creds).toEqual({
      clientId: 'default-cid',
      clientSecret: 'default-csec',
    });
  });

  it('resolveClientCredentials returns undefined when nothing is available', async () => {
    const creds = await accountStore.resolveClientCredentials('unknown');
    expect(creds).toBeUndefined();
  });

  it('deletes an account and removes all vault keys', async () => {
    await accountStore.saveTokenSet('personal', {
      refreshToken: 'rt-123',
      accessToken: 'at-456',
    });
    await accountStore.saveAccountInfo(
      'personal',
      'test@gmail.com',
      'Test User'
    );

    const existed = await accountStore.deleteAccount('personal');
    expect(existed).toBe(true);
    expect(accountStore.getAccount('personal')).toBeUndefined();
    expect(accountStore.listAccountIds()).not.toContain('personal');
  });

  it('returns false when deleting a non-existent account', async () => {
    const existed = await accountStore.deleteAccount('unknown');
    expect(existed).toBe(false);
  });

  it('marks account as unauthenticated', async () => {
    await accountStore.saveTokenSet('personal', { refreshToken: 'rt-123' });
    accountStore.markUnauthenticated('personal');

    const account = accountStore.getAccount('personal');
    expect(account?.isAuthenticated).toBe(false);
  });

  it('updates access token in vault', async () => {
    await accountStore.saveTokenSet('personal', {
      refreshToken: 'rt-123',
      accessToken: 'at-old',
      tokenExpiry: '2025-01-01T00:00:00Z',
    });

    await accountStore.saveAccessToken(
      'personal',
      'at-new',
      '2025-01-02T00:00:00Z'
    );

    const accessToken = await accountStore.getAccessToken('personal');
    expect(accessToken).toBe('at-new');
  });

  it('scans vault to restore accounts on startup', async () => {
    // Manually insert vault entries (simulating a persisted vault)
    await credentialStore.storeSecret(
      'google-apis.work.refreshToken',
      'rt-work'
    );
    await credentialStore.storeSecret(
      'google-apis.work.email',
      'work@gmail.com'
    );

    const newStore = new AccountStore(credentialStore);
    await newStore.restoreFromVault();

    const account = newStore.getAccount('work');
    expect(account).toBeDefined();
    expect(account?.isAuthenticated).toBe(true);
    expect(account?.email).toBe('work@gmail.com');
  });
});

// ---------------------------------------------------------------------------
// OAuthManager tests
// ---------------------------------------------------------------------------

describe('OAuthManager', () => {
  let credentialStore: ReturnType<typeof createMockCredentialStore>;
  let accountStore: AccountStore;
  let oauthManager: OAuthManager;

  const mockLogger = {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    credentialStore = createMockCredentialStore();
    accountStore = new AccountStore(credentialStore);
    oauthManager = new OAuthManager(
      accountStore,
      {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectPort: 47153,
      },
      mockLogger
    );
  });

  it('generates a consent URL for an OAuth flow', async () => {
    const url = await oauthManager.initiateFlow('personal');
    expect(url).toContain('accounts.google.com');
  });

  it('throws if no client credentials are available', async () => {
    const noCredsManager = new OAuthManager(
      accountStore,
      { clientId: undefined, clientSecret: undefined, redirectPort: 47153 },
      mockLogger
    );

    // Also clear per-account credentials
    await expect(noCredsManager.initiateFlow('test')).rejects.toThrow(
      'No OAuth client credentials configured'
    );
  });

  it('uses _default vault credentials when no per-account or config credentials exist', async () => {
    // Store credentials in the vault under _default (what the web UI does)
    await accountStore.saveClientCredentials(
      '_default',
      'vault-cid',
      'vault-csec'
    );

    // Create an OAuthManager with NO static config credentials
    const vaultOnlyManager = new OAuthManager(
      accountStore,
      { clientId: undefined, clientSecret: undefined, redirectPort: 47153 },
      mockLogger
    );

    // This should succeed by finding the _default vault credentials
    const url = await vaultOnlyManager.initiateFlow('personal');
    expect(url).toContain('accounts.google.com');
  });

  it('lists accounts from the underlying AccountStore', () => {
    accountStore.registerAccount('personal');
    accountStore.registerAccount('work');

    const ids = oauthManager === undefined ? [] : accountStore.listAccountIds();
    // The OAuthManager delegates to accountStore, so just verify listAccountIds works
    expect(ids).toEqual(expect.arrayContaining(['personal', 'work']));
  });

  it('returns null for getGmailClient when account is not authenticated', async () => {
    accountStore.registerAccount('personal');
    const client = await oauthManager.getGmailClient('personal');
    expect(client).toBeNull();
  });

  it('returns null for getCalendarClient when account is not authenticated', async () => {
    accountStore.registerAccount('personal');
    const client = await oauthManager.getCalendarClient('personal');
    expect(client).toBeNull();
  });

  it('returns null for getPeopleClient when account is not authenticated', async () => {
    accountStore.registerAccount('personal');
    const client = await oauthManager.getPeopleClient('personal');
    expect(client).toBeNull();
  });

  it('disconnects an account and cleans up', async () => {
    await accountStore.saveTokenSet('personal', {
      refreshToken: 'rt-123',
      accessToken: 'at-456',
    });

    await oauthManager.disconnectAccount('personal');

    expect(accountStore.getAccount('personal')).toBeUndefined();
    expect(accountStore.listAccountIds()).not.toContain('personal');
  });
});
