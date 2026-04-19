/**
 * @file account-store.ts
 *
 * Multi-account state management and token persistence for the google-apis plugin.
 * Maintains an in-memory account registry and persists OAuth tokens/profile data
 * in the credential-store vault using namespaced keys.
 */

/**
 * In-memory representation of a Google account known to this plugin.
 */
export type GoogleAccount = {
  /** Unique account identifier (e.g., "work", "personal"), user-chosen. */
  accountId: string;
  /** The Google account email, resolved after first auth. */
  email?: string;
  /** Display name from Google profile. */
  displayName?: string;
  /** Whether the OAuth flow has completed successfully and tokens are available. */
  isAuthenticated: boolean;
  /** Timestamp (ISO 8601) of last successful token refresh. */
  lastRefreshedAt?: string;
};

/**
 * Vault key namespace prefix used for all google-apis credential entries.
 * Keys follow the pattern: `google-apis.{accountId}.{field}`
 */
const VAULT_PREFIX = 'google-apis';

/**
 * Create the vault key for a given account ID and field.
 */
function vaultKey(accountId: string, field: string): string {
  return `${VAULT_PREFIX}.${accountId}.${field}`;
}

/**
 * Extract the account ID from a vault key like "google-apis.personal.refreshToken".
 * Returns undefined if the key doesn't match the expected pattern.
 */
function accountIdFromVaultKey(key: string): string | undefined {
  if (!key.startsWith(VAULT_PREFIX + '.')) return undefined;
  const afterPrefix = key.slice(VAULT_PREFIX.length + 1);
  const dotIndex = afterPrefix.indexOf('.');
  if (dotIndex === -1) return undefined;
  return afterPrefix.slice(0, dotIndex);
}

/**
 * Fields that are stored/retrieved from the vault for each account.
 */
const TOKEN_FIELDS = [
  'clientId',
  'clientSecret',
  'refreshToken',
  'accessToken',
  'tokenExpiry',
  'scopes',
  'email',
  'displayName',
];

/**
 * Interface for the credential-store capability that this module depends on.
 * Kept minimal so it can be easily mocked in tests.
 */
export interface CredentialStore {
  storeSecret(key: string, plaintext: string): Promise<void>;
  retrieveSecret(key: string): Promise<string | undefined>;
  deleteSecret(key: string): Promise<boolean>;
  listSecretKeys(): Promise<string[]>;
  hasSecret(key: string): Promise<boolean>;
}

/**
 * AccountStore manages the in-memory account registry and provides
 * methods to persist/retrieve tokens via the credential-store vault.
 */
export class AccountStore {
  private accounts = new Map<string, GoogleAccount>();
  private credentialStore: CredentialStore;

  constructor(credentialStore: CredentialStore) {
    this.credentialStore = credentialStore;
  }

  /**
   * Scan the credential vault for existing google-apis accounts and
   * restore them to the in-memory registry. Called during plugin startup.
   */
  async restoreFromVault(): Promise<void> {
    const allKeys = await this.credentialStore.listSecretKeys();
    const accountIds = new Set<string>();

    for (const key of allKeys) {
      const accountId = accountIdFromVaultKey(key);
      if (accountId) {
        accountIds.add(accountId);
      }
    }

    for (const accountId of accountIds) {
      const account = await this.loadAccount(accountId);
      if (account) {
        this.accounts.set(accountId, account);
      }
    }
  }

  /**
   * Register a new account (or update an existing one) in the in-memory registry.
   * Does NOT persist to vault — use saveTokenSet/saveAccountInfo for that.
   */
  registerAccount(accountId: string): GoogleAccount {
    const existing = this.accounts.get(accountId);
    if (existing) {
      return existing;
    }
    const account: GoogleAccount = {
      accountId,
      isAuthenticated: false,
    };
    this.accounts.set(accountId, account);
    return account;
  }

  /**
   * Get an account by ID, or undefined if not found.
   */
  getAccount(accountId: string): GoogleAccount | undefined {
    return this.accounts.get(accountId);
  }

  /**
   * List all known account IDs.
   */
  listAccountIds(): string[] {
    return Array.from(this.accounts.keys());
  }

  /**
   * Persist an OAuth token set to the vault and update the in-memory account.
   */
  async saveTokenSet(
    accountId: string,
    tokens: {
      refreshToken: string;
      accessToken?: string;
      tokenExpiry?: string;
      scopes?: string;
    }
  ): Promise<void> {
    this.registerAccount(accountId);

    await this.credentialStore.storeSecret(
      vaultKey(accountId, 'refreshToken'),
      tokens.refreshToken
    );

    if (tokens.accessToken) {
      await this.credentialStore.storeSecret(
        vaultKey(accountId, 'accessToken'),
        tokens.accessToken
      );
    }

    if (tokens.tokenExpiry) {
      await this.credentialStore.storeSecret(
        vaultKey(accountId, 'tokenExpiry'),
        tokens.tokenExpiry
      );
    }

    if (tokens.scopes) {
      await this.credentialStore.storeSecret(
        vaultKey(accountId, 'scopes'),
        tokens.scopes
      );
    }

    // Mark the account as authenticated since we have a refresh token
    const account = this.accounts.get(accountId)!;
    account.isAuthenticated = true;
  }

  /**
   * Save OAuth client credentials for a specific account to the vault.
   */
  async saveClientCredentials(
    accountId: string,
    clientId: string,
    clientSecret: string
  ): Promise<void> {
    this.registerAccount(accountId);

    await this.credentialStore.storeSecret(
      vaultKey(accountId, 'clientId'),
      clientId
    );
    await this.credentialStore.storeSecret(
      vaultKey(accountId, 'clientSecret'),
      clientSecret
    );
  }

  /**
   * Load client credentials for a specific account from the vault.
   * Returns undefined if not found.
   */
  async loadClientCredentials(
    accountId: string
  ): Promise<{ clientId: string; clientSecret: string } | undefined> {
    const clientId = await this.credentialStore.retrieveSecret(
      vaultKey(accountId, 'clientId')
    );
    const clientSecret = await this.credentialStore.retrieveSecret(
      vaultKey(accountId, 'clientSecret')
    );

    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }
    return undefined;
  }

  /**
   * Resolve client credentials for an account, falling back to the
   * `_default` vault entry if the account doesn't have its own.
   *
   * This is the primary method consumers should use — it mirrors the
   * resolution chain: per-account vault → `_default` vault.
   */
  async resolveClientCredentials(
    accountId: string
  ): Promise<{ clientId: string; clientSecret: string } | undefined> {
    // Per-account credentials take priority
    const perAccount = await this.loadClientCredentials(accountId);

    if (perAccount) {
      return perAccount;
    }

    // Fall back to the `_default` account credentials stored via the web UI
    const defaults = await this.loadClientCredentials('_default');

    return defaults;
  }

  /**
   * Persist profile information (email, display name) to the vault
   * and update the in-memory account.
   */
  async saveAccountInfo(
    accountId: string,
    email: string,
    displayName: string
  ): Promise<void> {
    this.registerAccount(accountId);

    await this.credentialStore.storeSecret(vaultKey(accountId, 'email'), email);
    await this.credentialStore.storeSecret(
      vaultKey(accountId, 'displayName'),
      displayName
    );

    const account = this.accounts.get(accountId)!;
    account.email = email;
    account.displayName = displayName;
  }

  /**
   * Retrieve a stored refresh token for an account.
   */
  async getRefreshToken(accountId: string): Promise<string | undefined> {
    const token = await this.credentialStore.retrieveSecret(
      vaultKey(accountId, 'refreshToken')
    );

    return token;
  }

  /**
   * Retrieve a cached access token for an account (may be expired).
   */
  async getAccessToken(accountId: string): Promise<string | undefined> {
    const token = await this.credentialStore.retrieveSecret(
      vaultKey(accountId, 'accessToken')
    );

    return token;
  }

  /**
   * Retrieve the stored token expiry timestamp for an account (ISO 8601 string).
   * Used by OAuthManager to set expiry_date on the OAuth2Client so it knows
   * when to proactively refresh the access token.
   */
  async getTokenExpiry(accountId: string): Promise<string | undefined> {
    const expiry = await this.credentialStore.retrieveSecret(
      vaultKey(accountId, 'tokenExpiry')
    );

    return expiry;
  }

  /**
   * Update the cached access token in the vault.
   */
  async saveAccessToken(
    accountId: string,
    accessToken: string,
    tokenExpiry: string
  ): Promise<void> {
    await this.credentialStore.storeSecret(
      vaultKey(accountId, 'accessToken'),
      accessToken
    );
    await this.credentialStore.storeSecret(
      vaultKey(accountId, 'tokenExpiry'),
      tokenExpiry
    );

    const account = this.accounts.get(accountId);
    if (account) {
      account.lastRefreshedAt = new Date().toISOString();
    }
  }

  /**
   * Delete all vault entries for an account and remove from the in-memory registry.
   */
  async deleteAccount(accountId: string): Promise<boolean> {
    const existed = this.accounts.has(accountId);
    this.accounts.delete(accountId);

    // Delete all vault keys for this account
    for (const field of TOKEN_FIELDS) {
      await this.credentialStore.deleteSecret(vaultKey(accountId, field));
    }

    return existed;
  }

  /**
   * Mark an account as unauthenticated (e.g., refresh token revoked).
   */
  markUnauthenticated(accountId: string): void {
    const account = this.accounts.get(accountId);
    if (account) {
      account.isAuthenticated = false;
    }
  }

  /**
   * Load a complete account from the vault by its account ID.
   * Returns undefined if no data exists for the account.
   */
  private async loadAccount(
    accountId: string
  ): Promise<GoogleAccount | undefined> {
    const refreshToken = await this.credentialStore.retrieveSecret(
      vaultKey(accountId, 'refreshToken')
    );
    if (!refreshToken) {
      // No refresh token means the account was never fully authenticated
      return undefined;
    }

    const email =
      (await this.credentialStore.retrieveSecret(
        vaultKey(accountId, 'email')
      )) ?? undefined;
    const displayName =
      (await this.credentialStore.retrieveSecret(
        vaultKey(accountId, 'displayName')
      )) ?? undefined;
    const lastRefreshedAt =
      (await this.credentialStore.retrieveSecret(
        vaultKey(accountId, 'tokenExpiry')
      )) ?? undefined;

    return {
      accountId,
      email,
      displayName,
      isAuthenticated: true,
      lastRefreshedAt,
    };
  }
}
