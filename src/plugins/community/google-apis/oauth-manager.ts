/**
 * @file oauth-manager.ts
 *
 * OAuth2 flow orchestration for the google-apis plugin.
 * Handles authorization code exchange, token refresh, and client creation
 * using google-auth-library's OAuth2Client.
 */

import * as crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { gmail } from '@googleapis/gmail';
import { calendar } from '@googleapis/calendar';
import { people } from '@googleapis/people';
import type { gmail_v1 } from '@googleapis/gmail';
import type { calendar_v3 } from '@googleapis/calendar';
import type { people_v1 } from '@googleapis/people';
import type { AccountStore } from './account-store.js';

/**
 * OAuth scopes required by the google-apis plugin.
 * Gmail: read-write (modify), Calendar: read-write, People/Profile: read-only.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/contacts.readonly',
] as const;

/**
 * Pending OAuth state stored in memory during an authorization flow.
 * These are ephemeral and expire after 10 minutes.
 */
type PendingOAuthState = {
  /** Cryptographically random state parameter for CSRF protection. */
  state: string;
  /** Account ID this flow is for. */
  accountId: string;
  /** Timestamp (ms since epoch) when the flow was initiated. */
  createdAt: number;
  /** OAuth2Client instance configured for this flow. */
  client: OAuth2Client;
};

/** How long a pending OAuth state is valid, in milliseconds (10 minutes). */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Default redirect path on the local web server.
 * The full redirect URI will be constructed based on the web-ui's port.
 */
const DEFAULT_REDIRECT_PATH = '/api/google-apis/oauth/callback';

/**
 * Logger interface to avoid coupling to the full plugin logger.
 */
export interface Logger {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * Plugin config shape needed by the OAuth manager.
 */
export interface OAuthManagerConfig {
  clientId?: string;
  clientSecret?: string;
  redirectPort?: number;
}

/**
 * OAuthManager handles the complete OAuth2 Authorization Code flow
 * with offline access for Google APIs.
 *
 * It manages:
 * - Generating consent URLs with correct scopes + offline access
 * - Exchanging authorization codes for tokens
 * - Automatic token refresh with persistence
 * - Creating authenticated Google API clients per account
 */
export class OAuthManager {
  private accountStore: AccountStore;
  private config: OAuthManagerConfig;
  private logger: Logger;

  /** Pending OAuth states, keyed by the random state parameter. */
  private pendingStates = new Map<string, PendingOAuthState>();

  /** Per-account refresh locks to prevent concurrent refresh races. */
  private refreshLocks = new Map<string, Promise<void>>();

  /** Cache of authenticated OAuth2Client instances per account. */
  private clientCache = new Map<string, OAuth2Client>();

  constructor(
    accountStore: AccountStore,
    config: OAuthManagerConfig,
    logger: Logger
  ) {
    this.accountStore = accountStore;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Initiate an OAuth flow for a given account ID.
   * Returns the Google consent URL that the user should visit.
   *
   * The redirect URI is constructed from the configured port.
   * A random state parameter is generated for CSRF protection and stored
   * in memory with a 10-minute TTL.
   */
  async initiateFlow(accountId: string): Promise<string> {
    // Ensure the account exists in our store
    this.accountStore.registerAccount(accountId);

    // Resolve client credentials: per-account vault → _default vault → plugin config
    const resolved =
      await this.accountStore.resolveClientCredentials(accountId);
    const clientId = resolved?.clientId ?? this.config.clientId ?? '';
    const clientSecret =
      resolved?.clientSecret ?? this.config.clientSecret ?? '';

    if (!clientId || !clientSecret) {
      throw new Error(
        `Cannot initiate OAuth flow for account "${accountId}": ` +
          'No OAuth client credentials configured. Please provide clientId ' +
          'and clientSecret via the plugin config or the web UI.'
      );
    }

    const redirectUri = this.buildRedirectUri();
    const state = crypto.randomBytes(32).toString('hex');

    const client = new OAuth2Client({
      clientId,
      clientSecret,
      redirectUri,
    });

    // Store the pending state
    this.pendingStates.set(state, {
      state,
      accountId,
      createdAt: Date.now(),
      client,
    });

    // Clean up expired states
    this.cleanupExpiredStates();

    // Generate the consent URL
    const consentUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES.join(' '),
      state,
    });

    this.logger.info(
      `initiateFlow: Generated OAuth consent URL for account "${accountId}".`
    );

    return consentUrl;
  }

  /**
   * Handle the OAuth callback: exchange the authorization code for tokens,
   * persist them in the vault, and update the account state.
   *
   * @param state - The state parameter from the callback (must match a pending state)
   * @param code - The authorization code from the callback
   * @returns The account ID that was authenticated
   * @throws Error if the state is invalid, expired, or the code exchange fails
   */
  async handleCallback(
    state: string,
    code: string
  ): Promise<{ accountId: string; email: string; displayName: string }> {
    const pending = this.pendingStates.get(state);
    if (!pending) {
      throw new Error(
        'Invalid or expired OAuth state parameter. ' +
          'Please try connecting your account again.'
      );
    }

    // Check if the state has expired
    if (Date.now() - pending.createdAt > OAUTH_STATE_TTL_MS) {
      this.pendingStates.delete(state);
      throw new Error(
        'OAuth state has expired (older than 10 minutes). ' +
          'Please try connecting your account again.'
      );
    }

    const { accountId, client } = pending;

    // Exchange the code for tokens
    let tokens;
    try {
      const response = await client.getToken(code);
      tokens = response.tokens;
    } catch (err) {
      this.logger.error(
        `handleCallback: Token exchange failed for account "${accountId}": ${err instanceof Error ? err.message : String(err)}`
      );
      throw new Error(
        `Failed to exchange authorization code for tokens: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }

    if (!tokens.refresh_token) {
      this.logger.error(
        `handleCallback: No refresh token received for account "${accountId}". ` +
          'This usually means the user has not granted offline access. ' +
          'The OAuth URL should include prompt=consent and access_type=offline.'
      );
      throw new Error(
        'No refresh token received from Google. Please try again — ' +
          'you may need to revoke existing access and re-authorize.'
      );
    }

    // Persist tokens to the vault
    await this.accountStore.saveTokenSet(accountId, {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? undefined,
      tokenExpiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : undefined,
      scopes: tokens.scope ?? undefined,
    });

    // Store the client credentials in the vault if they aren't already there.
    // We read them from the resolved chain (per-account → _default → config).
    const perAccount = await this.accountStore.loadClientCredentials(accountId);
    if (!perAccount) {
      // Per-account credentials don't exist yet — save the resolved ones
      const resolved =
        await this.accountStore.resolveClientCredentials(accountId);
      if (resolved) {
        await this.accountStore.saveClientCredentials(
          accountId,
          resolved.clientId,
          resolved.clientSecret
        );
      }
    }

    // Now fetch the user's profile to get email and display name
    const peopleClient = people({ version: 'v1', auth: client });
    let email = accountId; // fallback
    let displayName = accountId; // fallback

    try {
      const profile = await peopleClient.people.get({
        resourceName: 'people/me',
        personFields: 'emailAddresses,names',
      });

      const emailAddress = profile.data.emailAddresses?.[0]?.value;
      const name = profile.data.names?.[0]?.displayName;

      if (emailAddress) {
        email = emailAddress;
      }
      if (name) {
        displayName = name;
      }
    } catch (err) {
      this.logger.warn(
        `handleCallback: Could not fetch profile for account "${accountId}": ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Persist profile info
    await this.accountStore.saveAccountInfo(accountId, email, displayName);

    // Cache this client
    this.clientCache.set(accountId, client);

    // Set up automatic token refresh persistence
    this.setupTokenRefreshListener(accountId, client);

    // Clean up the pending state
    this.pendingStates.delete(state);

    this.logger.info(
      `handleCallback: Successfully authenticated account "${accountId}" (${email}).`
    );

    return { accountId, email, displayName };
  }

  /**
   * Get an authenticated OAuth2Client for a specific account.
   * Returns null if the account is not found or not authenticated.
   */
  async getClient(accountId: string): Promise<OAuth2Client | null> {
    // Check if we have a cached client
    const cached = this.clientCache.get(accountId);
    if (cached) {
      return cached;
    }

    // Check if the account is authenticated
    const account = this.accountStore.getAccount(accountId);

    if (!account || !account.isAuthenticated) {
      this.logger.warn(
        `getClient: Account "${accountId}" is not authenticated.`
      );
      return null;
    }

    // Build a new client from stored credentials
    const resolved =
      await this.accountStore.resolveClientCredentials(accountId);
    const clientId = resolved?.clientId ?? this.config.clientId ?? '';
    const clientSecret =
      resolved?.clientSecret ?? this.config.clientSecret ?? '';

    if (!clientId || !clientSecret) {
      this.logger.warn(
        `getClient: No client credentials found for account "${accountId}".`
      );
      return null;
    }

    const redirectUri = this.buildRedirectUri();
    const client = new OAuth2Client({
      clientId,
      clientSecret,
      redirectUri,
    });

    // Load tokens from the vault
    const refreshToken = await this.accountStore.getRefreshToken(accountId);
    const accessToken = await this.accountStore.getAccessToken(accountId);
    const tokenExpiry = await this.accountStore.getTokenExpiry(accountId);

    if (!refreshToken) {
      this.logger.warn(
        `getClient: No refresh token found for account "${accountId}".`
      );
      return null;
    }

    // Convert the ISO 8601 expiry string to a Unix timestamp in milliseconds.
    // If missing or unparseable, default to 0 (forces an immediate refresh).
    let expiryDate = 0;
    if (tokenExpiry) {
      const parsed = new Date(tokenExpiry).getTime();
      if (!Number.isNaN(parsed)) {
        expiryDate = parsed;
      }
    }

    client.setCredentials({
      refresh_token: refreshToken,
      access_token: accessToken ?? undefined,
      expiry_date: expiryDate,
    });

    // Set up automatic token refresh persistence
    this.setupTokenRefreshListener(accountId, client);

    // Cache the client
    this.clientCache.set(accountId, client);

    return client;
  }

  /**
   * Get an authenticated Gmail client for a specific account.
   * Returns null if the account is not available.
   */
  async getGmailClient(accountId: string): Promise<gmail_v1.Gmail | null> {
    const client = await this.getClient(accountId);
    if (!client) {
      return null;
    }

    return gmail({ version: 'v1', auth: client });
  }

  /**
   * Get an authenticated Calendar client for a specific account.
   * Returns null if the account is not available.
   */
  async getCalendarClient(
    accountId: string
  ): Promise<calendar_v3.Calendar | null> {
    const client = await this.getClient(accountId);
    if (!client) {
      return null;
    }

    return calendar({ version: 'v3', auth: client });
  }

  /**
   * Get an authenticated People client for a specific account.
   * Returns null if the account is not available.
   */
  async getPeopleClient(accountId: string): Promise<people_v1.People | null> {
    const client = await this.getClient(accountId);
    if (!client) return null;
    return people({ version: 'v1', auth: client });
  }

  /**
   * Disconnect an account: revoke tokens at Google (best-effort),
   * remove all stored credentials, and clear caches.
   */
  async disconnectAccount(accountId: string): Promise<void> {
    // Try to revoke the refresh token at Google (best-effort)
    try {
      const client = await this.getClient(accountId);
      if (client) {
        const refreshToken = await this.accountStore.getRefreshToken(accountId);
        if (refreshToken) {
          await client.revokeToken(refreshToken);
        }
      }
    } catch (err) {
      this.logger.warn(
        `disconnectAccount: Could not revoke token at Google for account "${accountId}": ${err instanceof Error ? err.message : String(err)}. ` +
          'This is usually fine — the token has been removed locally.'
      );
    }

    // Remove from the account store (which also removes vault entries)
    await this.accountStore.deleteAccount(accountId);

    // Remove cached client
    this.clientCache.delete(accountId);

    this.logger.info(
      `disconnectAccount: Account "${accountId}" disconnected and credentials removed.`
    );
  }

  /**
   * Try to refresh the access token for an account if it's expired.
   * Uses a per-account lock to prevent concurrent refresh races.
   */
  async refreshIfExpired(accountId: string): Promise<void> {
    // Serialize refresh attempts for the same account
    const existingLock = this.refreshLocks.get(accountId);
    if (existingLock) {
      // Another refresh is in progress; wait for it
      await existingLock;
      return;
    }

    const refreshPromise = this.doRefreshIfExpired(accountId);
    this.refreshLocks.set(accountId, refreshPromise);

    try {
      await refreshPromise;
    } finally {
      this.refreshLocks.delete(accountId);
    }
  }

  /**
   * Build the redirect URI from the configured port.
   */
  private buildRedirectUri(): string {
    const port = this.config.redirectPort ?? 47153;
    return `http://127.0.0.1:${port}${DEFAULT_REDIRECT_PATH}`;
  }

  /**
   * Set up a listener on the OAuth2Client that persists refreshed tokens
   * to the vault automatically.
   */
  private setupTokenRefreshListener(
    accountId: string,
    client: OAuth2Client
  ): void {
    client.on('tokens', async tokens => {
      this.logger.debug(
        `Token refresh event for account "${accountId}": has access_token=${!!tokens.access_token}, has refresh_token=${!!tokens.refresh_token}`
      );

      try {
        if (tokens.access_token) {
          await this.accountStore.saveAccessToken(
            accountId,
            tokens.access_token,
            tokens.expiry_date
              ? new Date(tokens.expiry_date).toISOString()
              : new Date(Date.now() + 3600 * 1000).toISOString()
          );
        }

        // If we also got a new refresh token (rare but possible),
        // persist it as well
        if (tokens.refresh_token) {
          await this.accountStore.saveTokenSet(accountId, {
            refreshToken: tokens.refresh_token,
            accessToken: tokens.access_token ?? undefined,
            tokenExpiry: tokens.expiry_date
              ? new Date(tokens.expiry_date).toISOString()
              : undefined,
            scopes: tokens.scope ?? undefined,
          });
        }
      } catch (err) {
        this.logger.error(
          `Failed to persist refreshed tokens for account "${accountId}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });
  }

  /**
   * Clean up expired OAuth state entries from the in-memory map.
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    const entries = Array.from(this.pendingStates.entries());
    for (const [key, state] of entries) {
      if (now - state.createdAt > OAUTH_STATE_TTL_MS) {
        this.pendingStates.delete(key);
      }
    }
  }

  /**
   * Internal implementation of the refresh-if-expired logic.
   */
  private async doRefreshIfExpired(accountId: string): Promise<void> {
    const client = await this.getClient(accountId);
    if (!client) return;

    // The OAuth2Client automatically refreshes expired tokens when making
    // API calls, but we can proactively refresh here by checking the
    // credentials' expiry. We don't need to do anything proactive —
    // the client handles it via the 'tokens' event listener we set up.
    // This method exists to force a refresh if needed.
    const credentials = client.credentials;
    if (credentials.expiry_date && credentials.expiry_date < Date.now()) {
      // Token is expired; trigger a refresh by calling refreshAccessToken
      try {
        await client.getAccessToken();
      } catch (err) {
        this.logger.warn(
          `refreshIfExpired: Token refresh failed for account "${accountId}": ${err instanceof Error ? err.message : String(err)}`
        );
        this.accountStore.markUnauthenticated(accountId);
      }
    }
  }
}
