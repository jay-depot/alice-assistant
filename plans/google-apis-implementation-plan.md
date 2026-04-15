# Implementation Plan: google-apis

## Overview

A multi-account, read-write Google API broker plugin for A.L.I.C.E. Assistant. Following the `brave-search-api` pattern, `google-apis` is a **pure infrastructure plugin** — it handles OAuth2 authentication lifecycle and offers authenticated Google API clients to downstream consumer plugins, but registers **zero LLM tools** of its own. A companion `google-location` plugin bridges Google's geolocation data into the existing `location-broker`.

This is **Phase 1**: authentication broker + location provider. Gmail and Calendar API clients will be offered as capabilities but no tool-registering consumer plugins will be built in this phase.

## Requirements Summary

### Functional Requirements

| #     | Requirement                                                                                                  | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------ | -------- |
| FR-1  | Full OAuth2 Authorization Code flow with offline access (refresh tokens)                                     | Must     |
| FR-2  | Multi-account support: multiple Google accounts authenticated simultaneously                                 | Must     |
| FR-3  | Authenticated Gmail v1, Calendar v3, and People v1 clients offered to downstream plugins per account         | Must     |
| FR-4  | OAuth tokens (access + refresh) persisted in `credential-store` vault, namespaced per account                | Must     |
| FR-5  | Automatic token refresh when access tokens expire                                                            | Must     |
| FR-6  | OAuth callback served on the `web-ui` Express server at `/api/google-apis/oauth/callback`                    | Must     |
| FR-7  | Web UI page for managing Google accounts (connect, disconnect, view status)                                  | Must     |
| FR-8  | REST API endpoints for account management                                                                    | Must     |
| FR-9  | `google-location` community plugin that registers as a `location-broker` provider using Google's geolocation | Must     |
| FR-10 | Read-write scopes for Gmail and Calendar; read-only for People/Contacts                                      | Must     |
| FR-11 | Plugin disabled by default (cloud integration)                                                               | Must     |
| FR-12 | Google Cloud project credentials (`client_id`, `client_secret`) provided by the user via config or vault     | Must     |

### Non-Functional Requirements

| #     | Requirement                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------- |
| NFR-1 | Tokens are never logged or exposed in tool output (redactor integration)                                                  |
| NFR-2 | Access tokens are short-lived; refresh tokens are the only long-lived credential stored                                   |
| NFR-3 | OAuth state parameter uses cryptographically random values to prevent CSRF                                                |
| NFR-4 | All REST API endpoints are bound to `127.0.0.1` (inherited from `web-ui`)                                                 |
| NFR-5 | Plugin degrades gracefully: if no accounts are connected, `getAuthenticatedClient()` returns `null` with a logger warning |
| NFR-6 | No Google API calls are made at plugin registration time (no network I/O during startup)                                  |

## Architecture & Design

### High-Level Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    google-apis (broker)                       │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  OAuth Flow  │  │ Token Store  │  │  Client Factory      │ │
│  │  (web-ui)    │  │ (cred-store) │  │  (offers clients)    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘ │
│         │                 │                     │             │
│         │          credential-store             │             │
│         │          (dependency)                 │             │
└─────────┼─────────────────┼─────────────────────┼─────────────┘
          │                 │                     │
          │                 │            ┌────────┴────────────┐
          │                 │            │  Future consumer    │
          │                 │            │  plugins:           │
          │                 │            │  - google-gmail     │
          │                 │            │  - google-calendar  │
          │                 │            └─────────────────────┘
          │                 │
          │    ┌────────────┴─────────────────────────┐
          │    │  google-location (location provider) │
          │    │  depends on: google-apis,            │
          │    │              location-broker         │
          │    └──────────────────────────────────────┘
```

### Component Breakdown

#### `google-apis` — OAuth Broker Plugin

| Component                | Responsibility                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `google-apis.ts`         | Main plugin definition, registration, lifecycle hooks, REST routes                             |
| `oauth-manager.ts`       | OAuth2 flow orchestration: generate auth URLs, exchange codes, refresh tokens                  |
| `account-store.ts`       | Multi-account state: account registry, token persistence via `credential-store`, token refresh |
| `google-apis-web-ui.tsx` | React component for account management page                                                    |
| `google-apis-web-ui.css` | Styles for the web UI page                                                                     |

#### `google-location` — Location Provider Plugin

| Component            | Responsibility                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `google-location.ts` | Single-file plugin: requests `google-apis` client, calls People API for locale/geolocation, registers with `location-broker` |

### Data Models

#### Google Account (in-memory representation)

```typescript
type GoogleAccount = {
  /** Unique account identifier (e.g., "work", "personal"), user-chosen */
  accountId: string;
  /** The Google account email, resolved after first auth */
  email?: string;
  /** Display name from Google profile */
  displayName?: string;
  /** Whether the OAuth flow has completed successfully */
  isAuthenticated: boolean;
  /** Timestamp of last successful token refresh */
  lastRefreshedAt?: string;
};
```

#### Vault Keys (persisted in `credential-store`)

Each Google account's credentials are stored as multiple namespaced vault keys:

```
google-apis.{accountId}.clientId       — OAuth client ID
google-apis.{accountId}.clientSecret   — OAuth client secret
google-apis.{accountId}.refreshToken   — Long-lived refresh token
google-apis.{accountId}.accessToken    — Short-lived access token (cached, may be empty)
google-apis.{accountId}.tokenExpiry    — ISO 8601 expiry timestamp
google-apis.{accountId}.scopes         — Comma-separated granted scopes
google-apis.{accountId}.email          — Account email (from profile)
google-apis.{accountId}.displayName   — Display name (from profile)
```

#### OAuth State (ephemeral, in-memory)

```typescript
type PendingOAuthState = {
  /** Cryptographically random state parameter */
  state: string;
  /** Account ID this flow is for */
  accountId: string;
  /** PKCE code verifier (optional, for extra security) */
  codeVerifier?: string;
  /** Timestamp when the flow was initiated */
  createdAt: number;
};
```

Pending states are held in memory only and expire after 10 minutes.

### API Contracts

#### Offered Capability (`google-apis`)

> **Note:** The capability methods that return Google API clients are **async** — they return `Promise<...>` rather than plain values. This is because the underlying `OAuthManager` may need to load tokens from the vault or refresh expired credentials before producing a client. The original plan spec showed sync signatures; the actual implementation correctly returns promises. Consumer plugins **must** `await` these calls.

```typescript
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'google-apis': {
      /** Get an authenticated OAuth2 client for a specific account. Returns null if account not found or not authenticated. */
      getAuthenticatedClient: (
        accountId: string
      ) => Promise<OAuth2Client | null>;

      /** Get an authenticated Gmail client for a specific account. Returns null if not available. */
      getGmailClient: (accountId: string) => Promise<gmail_v1.Gmail | null>;

      /** Get an authenticated Calendar client for a specific account. Returns null if not available. */
      getCalendarClient: (
        accountId: string
      ) => Promise<calendar_v3.Calendar | null>;

      /** Get an authenticated People client for a specific account. Returns null if not available. */
      getPeopleClient: (accountId: string) => Promise<people_v1.People | null>;

      /** List all authenticated account IDs. */
      listAccounts: () => string[];

      /** Get account metadata (email, displayName, isAuthenticated). */
      getAccountInfo: (accountId: string) => GoogleAccount | null;

      /** Initiate the OAuth flow for a new or existing account. Returns the consent URL. */
      initiateOAuthFlow: (accountId: string) => Promise<string>;

      /** Disconnect and revoke tokens for an account. */
      disconnectAccount: (accountId: string) => Promise<void>;
    };
  }
}
```

#### REST API Endpoints

| Method   | Path                                          | Purpose                                                       |
| -------- | --------------------------------------------- | ------------------------------------------------------------- |
| `GET`    | `/api/google-apis/accounts`                   | List all configured accounts and their status                 |
| `POST`   | `/api/google-apis/accounts`                   | Start OAuth flow for a new account (`{ accountId }`)          |
| `DELETE` | `/api/google-apis/accounts/:accountId`        | Disconnect an account and revoke its token                    |
| `GET`    | `/api/google-apis/accounts/:accountId/status` | Detailed status for one account                               |
| `GET`    | `/api/google-apis/oauth/callback`             | OAuth2 redirect URI handler                                   |
| `GET`    | `/api/google-apis/config`                     | Get current client ID (non-secret) + redirect URI             |
| `POST`   | `/api/google-apis/config`                     | Store OAuth client credentials (`{ clientId, clientSecret }`) |

#### Web UI Route

| Path           | Title       | Component               |
| -------------- | ----------- | ----------------------- |
| `/google-apis` | Google APIs | `GoogleApisManagerPage` |

## New Package Dependencies

| Package                | Version   | Justification                                                                                                                                                                                                               |
| ---------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@googleapis/gmail`    | `^0.3.0`  | Provides `gmail_v1.Gmail` client type and API methods. Individual submodule avoids importing the entire `googleapis` monolith (~100x smaller).                                                                              |
| `@googleapis/calendar` | `^0.3.0`  | Provides `calendar_v3.Calendar` client type and API methods. Same rationale as above.                                                                                                                                       |
| `@googleapis/people`   | `^0.1.0`  | Provides `people_v1.People` client. Used for account profile resolution and location data.                                                                                                                                  |
| `google-auth-library`  | `^10.0.0` | Core OAuth2 client implementation (`OAuth2Client`). Handles token lifecycle (exchange, refresh, auto-refresh on 401). The `@googleapis/*` packages depend on this transitively but we need it directly for the auth broker. |

**Why NOT `googleapis`?** The `googleapis` meta-package imports ALL ~300 Google API definitions, resulting in significant install size and startup cost. Using individual `@googleapis/<api>` submodules is the official recommendation for projects that only need a few APIs. Each submodule is independently typed and exports its own client constructor with auth support.

**Alternative considered:** `googleapis` monolith — rejected due to bundle size. The `@googleapis/*` submodules are published from the same monorepo and maintained in lockstep version, so there is no API surface loss.

## Project Structure

```
src/plugins/community/google-apis/
  ├── google-apis.ts                    # Main plugin definition & registration
  ├── oauth-manager.ts                  # OAuth2 flow orchestration
  ├── account-store.ts                  # Multi-account state & token persistence
  ├── google-apis-web-ui.tsx            # React web UI for account management
  ├── google-apis-web-ui.css            # Styles
  └── google-apis.test.ts               # Unit tests (co-located)

src/plugins/community/google-location/
  └── google-location.ts                # Location bridge plugin (single file)
```

This follows the existing project conventions:

- Community plugins live in `src/plugins/community/`
- Single-file plugins where complexity allows (like `static-location`)
- Multi-file plugins where domain logic warrants it (like `credential-store`)
- Test files are co-located (`.test.ts` suffix)
- Web UI files use the `*-web-ui.tsx` / `*-web-ui.css` naming convention

## Implementation Steps

> **STATUS: All 10 steps are COMPLETE. Build, lint, and all 430 tests pass.**

### Step 1: Install npm dependencies ✅

**Description:** Add the Google API packages and `google-auth-library` as production dependencies.

```bash
npm install @googleapis/gmail @googleapis/calendar @googleapis/people google-auth-library
```

**Files to modify:**

- `package.json` (via npm install)
- `package-lock.json` (via npm install)

**Dependencies:** None

**Estimated complexity:** Low

---

### Step 2: Create `account-store.ts` — Multi-Account State & Token Persistence ✅

**Description:** Implement the `AccountStore` class that manages the in-memory account registry and provides methods to persist/retrieve tokens via `credential-store`. This is the data layer of the plugin.

Key responsibilities:

- Maintain an in-memory `Map<string, GoogleAccount>` of registered accounts
- On startup, load account IDs and tokens from the credential vault by scanning for keys matching the `google-apis.*` namespace pattern
- Provide `saveTokenSet(accountId, tokens)` — stores access token, refresh token, expiry, and scopes as individual vault keys
- Provide `loadTokenSet(accountId)` — retrieves and reassembles the OAuth tokens from the vault
- Provide `saveAccountInfo(accountId, email, displayName)` — persists profile data
- Provide `deleteAccount(accountId)` — removes all vault keys for an account
- Provide `listAccountIds()` — returns all known account IDs
- Provide `getAccount(accountId)` — returns the `GoogleAccount` object

Vault key convention: `google-apis.{accountId}.{field}`. For example:

- `google-apis.personal.refreshToken`
- `google-apis.personal.accessToken`
- `google-apis.personal.clientId`

Account detection at startup: scan vault keys for the `google-apis.` prefix, group by the second segment to identify account IDs, then load each account's metadata.

**Files to create:**

- `src/plugins/community/google-apis/account-store.ts`

**Dependencies:** None (only depends on `credential-store` interface, injected at construction)

**Estimated complexity:** Medium

---

### Step 3: Create `oauth-manager.ts` — OAuth2 Flow Orchestration ✅

**Description:** Implement the `OAuthManager` class that handles the full OAuth2 Authorization Code flow with offline access.

Key responsibilities:

- Generate consent URLs with `access_type: 'offline'` and `prompt: 'consent'` to ensure refresh tokens
- Use cryptographically random `state` parameter (32 bytes from `node:crypto.randomBytes`) for CSRF protection
- Store pending OAuth states in an in-memory `Map<string, PendingOAuthState>` with 10-minute TTL
- Exchange authorization codes for tokens (`oauth2Client.getToken(code)`)
- Listen for `oauth2Client.on('tokens', ...)` events to capture refreshed tokens and persist them
- Provide `createAuthenticatedClient(accountId)` — builds an `OAuth2Client` with stored tokens, sets up auto-refresh
- Handle token refresh failures gracefully (mark account as unauthenticated, log warning)

Scopes requested (read-write for Gmail and Calendar; read-only for People):

```typescript
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify', // read-write Gmail
  'https://www.googleapis.com/auth/calendar', // read-write Calendar
  'https://www.googleapis.com/auth/userinfo.profile', // read profile
  'https://www.googleapis.com/auth/userinfo.email', // read email
  'https://www.googleapis.com/auth/contacts.readonly', // read-only contacts
] as const;
```

The `gmail.modify` scope (vs `gmail.full_access`) is the minimum read-write scope that allows sending, reading, and labeling without deletion permissions. If the user wants full Gmail control, this can be changed in config.

Client credentials resolution order:

1. Vault keys `google-apis.{accountId}.clientId` / `google-apis.{accountId}.clientSecret` (per-account)
2. Plugin config `clientId` / `clientSecret` (shared defaults)
3. If neither source has credentials, the OAuth flow cannot proceed — log a warning

**Files to create:**

- `src/plugins/community/google-apis/oauth-manager.ts`

**Dependencies:** Step 2 (AccountStore)

**Estimated complexity:** High

---

### Step 4: Create `google-apis.ts` — Main Plugin Definition ✅

**Description:** Wire everything together as the main A.L.I.C.E. plugin. Follow the `brave-search-api` + `credential-store` patterns.

Key structure:

1. Define TypeBox config schema with optional `clientId`, `clientSecret`, and `redirectPort` fields
2. Declare `PluginCapabilities` augmentation for `'google-apis'`
3. In `registerPlugin()`:
   - Load config via `plugin.config(schema, defaults)`
   - Request `credential-store` and `web-ui` dependencies
   - Instantiate `AccountStore` and `OAuthManager`
   - Restore previously-authenticated accounts from vault
   - Call `plugin.offer<'google-apis'>(...)` with all capability methods
4. In `onAssistantWillAcceptRequests` hook:
   - Log startup status (number of accounts, which are authenticated)
   - Attempt a silent token refresh for any accounts with expired access tokens
5. In `onAssistantAcceptsRequests` hook:
   - Register REST API routes on `webUi.express`
   - Register web UI script/stylesheet via `webUi.registerScript()` / `webUi.registerStylesheet()`

The `offer` block should expose:

```typescript
plugin.offer<'google-apis'>({
  getAuthenticatedClient: accountId => oauthManager.getClient(accountId),
  getGmailClient: accountId => oauthManager.getGmailClient(accountId),
  getCalendarClient: accountId => oauthManager.getCalendarClient(accountId),
  getPeopleClient: accountId => oauthManager.getPeopleClient(accountId),
  listAccounts: () => accountStore.listAccountIds(),
  getAccountInfo: accountId => accountStore.getAccount(accountId),
  initiateOAuthFlow: accountId => oauthManager.initiateFlow(accountId),
  disconnectAccount: accountId => disconnectAccount(accountId),
});
```

Client factory methods in `OAuthManager`:

```typescript
getGmailClient(accountId: string): gmail_v1.Gmail | null {
  const client = this.getClient(accountId);
  if (!client) return null;
  return gmail({ version: 'v1', auth: client });
}

getCalendarClient(accountId: string): calendar_v3.Calendar | null {
  const client = this.getClient(accountId);
  if (!client) return null;
  return calendar({ version: 'v3', auth: client });
}

getPeopleClient(accountId: string): people_v1.People | null {
  const client = this.getClient(accountId);
  if (!client) return null;
  return people({ version: 'v1', auth: client });
}
```

**Plugin metadata:**

```typescript
pluginMetadata: {
  id: 'google-apis',
  name: 'Google APIs Plugin',
  brandColor: '#4285f4',  // Google Blue
  description:
    'Provides authenticated Google API clients (Gmail, Calendar, People) ' +
    'for other plugins to use. Handles OAuth2 authentication with multi-account ' +
    'support and persists tokens in the credential vault.',
  version: 'LATEST',
  dependencies: [
    { id: 'credential-store', version: 'LATEST' },
    { id: 'web-ui', version: 'LATEST' },
  ],
  required: false,
}
```

**Files to create:**

- `src/plugins/community/google-apis/google-apis.ts`

**Dependencies:** Steps 2, 3

**Estimated complexity:** High

---

### Step 5: Create `google-apis-web-ui.tsx` and `google-apis-web-ui.css` ✅

**Description:** React web UI component for managing Google accounts. Follows the `credential-store-web-ui.tsx` pattern closely.

The page should display:

1. **OAuth Client Configuration section**: fields for `clientId` and `clientSecret`, with a "Save" button (POSTs to `/api/google-apis/config`). Shows a link to Google Cloud Console instructions.
2. **Connected Accounts section**: list of accounts with email, display name, auth status, and last-refreshed timestamp. Each account has a "Disconnect" button.
3. **Add Account section**: text input for account ID (e.g., "work", "personal"), "Connect" button that triggers the OAuth flow (calls POST `/api/google-apis/accounts`, receives a `consentUrl`, then `window.location.href = consentUrl`).
4. **OAuth Callback Handler**: When the page loads at `/google-apis?code=...&state=...`, automatically POST the callback params to `/api/google-apis/oauth/callback` (actually the callback is handled server-side, but the UI should show a success/failure message after redirect).

Uses `globalThis.React` (same pattern as `credential-store-web-ui.tsx`).

**Files to create:**

- `src/plugins/community/google-apis/google-apis-web-ui.tsx`
- `src/plugins/community/google-apis/google-apis-web-ui.css`

**Dependencies:** Step 4 (REST API must exist)

**Estimated complexity:** Medium

---

### Step 6: Create `google-location.ts` — Location Bridge Plugin ✅

**Description:** A lightweight single-file community plugin that depends on `google-apis` and `location-broker`, and registers as a location provider.

Flow:

1. In `registerPlugin()`: request both `google-apis` and `location-broker` capabilities
2. In `onAllPluginsLoaded` hook (registration must happen before `location-broker` closes registration):
   - Check if any Google account is authenticated
   - If so, call `registerLocationProvider('google-location', callback)`
3. The provider callback:
   - Calls `getPeopleClient(accountId)` on the first available account
   - Fetches the user's profile (which includes locale and residential address if available)
   - Maps the Google profile data to `LocationData` format
   - If Google doesn't provide coordinates directly, try a lightweight geocoding approach (e.g., use the locality/region from the profile)

**Important constraint:** The `location-broker` only allows one provider. If `static-location` is also enabled, the assistant will refuse to start with an error. This is the intended behavior — the user must choose one. The `google-location` plugin should clearly document this in its description.

**Plugin metadata:**

```typescript
pluginMetadata: {
  id: 'google-location',
  name: 'Google Location Plugin',
  brandColor: '#34a853',  // Google Green
  description:
    'A location provider plugin that uses an authenticated Google account ' +
    'to provide location data to location-broker. Conflicts with static-location — ' +
    'only one location provider can be enabled at a time.',
  version: 'LATEST',
  dependencies: [
    { id: 'google-apis', version: 'LATEST' },
    { id: 'location-broker', version: 'LATEST' },
  ],
  required: false,
}
```

**Files to create:**

- `src/plugins/community/google-location/google-location.ts`

**Dependencies:** Step 4 (google-apis must be complete)

**Estimated complexity:** Low-Medium

---

### Step 7: Register Plugins in `system-plugins.json` and `enabled-plugins.json` ✅

**Description:** Add both new plugins to the built-in plugin registry (as community, not required) and disable them by default.

Add to `src/plugins/system-plugins.json` (before the closing `]`):

```json
{
  "id": "google-apis",
  "name": "Google APIs",
  "category": "community",
  "required": false
},
{
  "id": "google-location",
  "name": "Google Location",
  "category": "community",
  "required": false
}
```

Add to `config-default/plugin-settings/enabled-plugins.json` in the `"system"` object:

```json
"google-apis": false,
"google-location": false
```

Both are **disabled by default** per the project rule: cloud model integrations must be disabled by default.

**Files to modify:**

- `src/plugins/system-plugins.json`
- `config-default/plugin-settings/enabled-plugins.json`

**Dependencies:** Steps 4, 6

**Estimated complexity:** Low

---

### Step 8: Create Plugin Config Scaffold ✅

**Description:** Add default config files for the new plugins.

`config-default/plugin-settings/google-apis/google-apis.json`:

```json
{
  "clientId": "",
  "clientSecret": "",
  "redirectPort": 47153
}
```

`config-default/plugin-settings/google-location/google-location.json`:

```json
{
  "preferredAccount": ""
}
```

The `redirectPort` defaults to the same port as the web UI (from `alice.json`). The `preferredAccount` in `google-location` specifies which account to use for location data when multiple accounts are connected (empty string = first available).

**Files to create:**

- `config-default/plugin-settings/google-apis/google-apis.json`
- `config-default/plugin-settings/google-location/google-location.json`

**Dependencies:** Step 7

**Estimated complexity:** Low

---

### Step 9: Write Unit Tests ✅

**Description:** Co-located test files for the main modules.

**`google-apis.test.ts`** — Tests for:

- `AccountStore`: account creation, token persistence (mocked `credential-store`), account listing, deletion
- `OAuthManager`: state generation (randomness), state expiry, consent URL generation with correct scopes
- Plugin registration: verify `offer` is called with correct capability shape
- Config migration: if clientId/clientSecret are in config, they should be migrated to vault

**`google-location.test.ts`** — Tests for:

- Provider registration with `location-broker` (mocked)
- Graceful handling when `google-apis` has no authenticated accounts
- `LocationData` mapping from mocked People API response

Use `vi.mock()` at the top level for all external dependencies. Follow existing test patterns from `credential-store.test.ts` and `location-broker.test.ts`.

**Files to create:**

- `src/plugins/community/google-apis/google-apis.test.ts`
- `src/plugins/community/google-location/google-location.test.ts`

**Dependencies:** Steps 4, 6

**Estimated complexity:** Medium

---

### Step 10: Verify Build, Lint, and Tests ✅

**Description:** Run the full CI pipeline to verify everything works.

```bash
npm run build
npm run lint
npm test
```

Fix any issues that arise. Particular attention to:

- ESM import paths with `.js` extensions
- `node:` prefix for Node.js built-ins
- Typebox schema alignment
- No `any` types in production code
- Plugin capability types are correctly augmenting `PluginCapabilities`

**Files to modify:** (fixup only, as needed)

**Dependencies:** All previous steps

**Estimated complexity:** Low-Medium

## File Changes Summary

| File                                                                  | Action | Status  | Description                                                                                  |
| --------------------------------------------------------------------- | ------ | ------- | -------------------------------------------------------------------------------------------- |
| `package.json`                                                        | Modify | ✅ Done | Add `@googleapis/gmail`, `@googleapis/calendar`, `@googleapis/people`, `google-auth-library` |
| `src/plugins/community/google-apis/account-store.ts`                  | Create | ✅ Done | Multi-account state management & vault persistence                                           |
| `src/plugins/community/google-apis/oauth-manager.ts`                  | Create | ✅ Done | OAuth2 flow orchestration, token lifecycle                                                   |
| `src/plugins/community/google-apis/google-apis.ts`                    | Create | ✅ Done | Main plugin definition, registration, REST routes                                            |
| `src/plugins/community/google-apis/google-apis-web-ui.tsx`            | Create | ✅ Done | React web UI for account management                                                          |
| `src/plugins/community/google-apis/google-apis-web-ui.css`            | Create | ✅ Done | Web UI styles                                                                                |
| `src/plugins/community/google-apis/google-apis.test.ts`               | Create | ✅ Done | Unit tests (22 tests for AccountStore + OAuthManager)                                        |
| `src/plugins/community/google-location/google-location.ts`            | Create | ✅ Done | Location broker bridge plugin                                                                |
| `src/plugins/community/google-location/google-location.test.ts`       | Create | ✅ Done | Unit tests (6 tests for google-location)                                                     |
| `src/plugins/system-plugins.json`                                     | Modify | ✅ Done | Add `google-apis` and `google-location` entries                                              |
| `config-default/plugin-settings/enabled-plugins.json`                 | Modify | ✅ Done | Add both plugins as `false`                                                                  |
| `config-default/plugin-settings/google-apis/google-apis.json`         | Create | ✅ Done | Default plugin config scaffold                                                               |
| `config-default/plugin-settings/google-location/google-location.json` | Create | ✅ Done | Default plugin config scaffold                                                               |

## Testing Strategy

### Unit Tests

| Module               | Test Cases                                                                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account-store.ts`   | Create account, list accounts, save/load tokens (mocked vault), delete account removes all keys, startup vault scan discovers existing accounts                                                                                                 |
| `oauth-manager.ts`   | State generation is crypto-random, state expires after 10 min, consent URL includes correct scopes + `access_type=offline`, `createAuthenticatedClient` returns null for unknown account, token refresh persistence via `on('tokens')` listener |
| `google-apis.ts`     | Plugin registers without errors, `offer()` called with expected shape, config migration moves clientId/clientSecret to vault, graceful degradation when no accounts configured                                                                  |
| `google-location.ts` | Registers provider when accounts exist, returns empty `LocationData` when no accounts, provider callback maps People API response to `LocationData`, conflict with existing provider throws expected error                                      |

### Integration Tests

- Manual OAuth flow: configure client credentials, initiate flow, complete browser consent, verify tokens stored in vault
- Token refresh: manually expire an access token, call an API method, verify auto-refresh works and new tokens are persisted
- Multi-account: connect two Google accounts, verify `listAccounts()` returns both, verify client isolation
- Web UI: verify `/google-apis` page loads, account list renders, connect/disconnect buttons work
- Location bridge: enable `google-location`, disable `static-location`, verify location footer prompt shows Google-derived location

### Manual Testing Steps

1. `npm run build && npm start`
2. Open web UI at `http://127.0.0.1:47153`
3. Navigate to Settings → enable `google-apis` and `google-location`, disable `static-location`
4. Restart assistant
5. Navigate to `/google-apis` page
6. Enter Google Cloud OAuth client credentials
7. Click "Add Account", enter account ID, click "Connect"
8. Complete Google consent flow in browser
9. Verify redirect back to `/google-apis` with success message
10. Verify account appears in list with email and status
11. Verify vault keys exist via `/api/credentials`
12. Disable `google-apis`, restart — verify no errors, verify `google-location` degrades gracefully

## Definition of Done

- [x] `npm run build` completes with zero errors
- [x] `npm run lint` completes with zero errors
- [x] `npm test` passes with new test cases
- [x] `google-apis` plugin registers successfully and offers the `'google-apis'` capability
- [x] `google-location` plugin registers as a `location-broker` provider
- [ ] OAuth2 Authorization Code flow completes end-to-end via the web UI _(requires manual testing with real Google credentials)_
- [x] Tokens are persisted in the `credential-store` vault with correct namespaced keys
- [ ] Access token auto-refresh works (expired token → API call → auto-refresh → new token persisted) _(requires manual testing with real Google credentials)_
- [ ] Multiple Google accounts can be connected and managed independently _(requires manual testing with real Google credentials)_
- [ ] `getGmailClient()`, `getCalendarClient()`, and `getPeopleClient()` return authenticated clients _(requires manual testing with real Google credentials)_
- [x] Web UI at `/google-apis` shows account list, supports connect/disconnect
- [ ] `google-location` provider callback returns `LocationData` from Google profile _(requires manual testing with real Google credentials)_
- [x] Both plugins are disabled by default in `enabled-plugins.json`
- [x] Both plugins appear in `system-plugins.json` as community/optional
- [x] No secrets (tokens, client secrets) appear in log output or tool results
- [x] No network I/O occurs at plugin registration time (only at request time)
- [x] Plugin degrades gracefully when no accounts are configured (returns `null`, logs warning)

## Risks & Mitigations

| Risk                                                                                          | Impact                                                            | Mitigation                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google OAuth client credentials (client_id/client_secret) must be created by each user        | High — complex setup flow, poor first-time experience             | Provide detailed setup guide in web UI with step-by-step Google Cloud Console instructions. Pre-fill redirect URI. Consider a future "quick start" flow.                                 |
| Refresh tokens can expire or be revoked silently                                              | Medium — account becomes unauthenticated without warning          | On every `getAuthenticatedClient()` call, check token expiry. If refresh fails, mark account as unauthenticated and log a prominent warning. Re-auth is always available via the web UI. |
| `@googleapis/*` submodules may lag behind `googleapis` monolith in versions                   | Low — API surface differences                                     | Pin to known-working versions. The submodules are published from the same monorepo and usually stay synchronized. Verify the versions we install have the needed API methods.            |
| `google-auth-library` v10 is relatively new (archived repo moved to `google-cloud-node-core`) | Medium — potential instability, breaking changes                  | Pin exact version in `package.json`. The library is still officially maintained under the new monorepo. Monitor for migration issues.                                                    |
| People API may not return precise location data                                               | Medium — `google-location` provider returns low-fidelity location | Document that Google profile location is approximate (city/region level). A future enhancement could use Google's Geolocation API or the user's IP-based geolocation.                    |
| `location-broker` only supports one provider — conflicts with `static-location`               | Low — user confusion when both are enabled                        | Error message from `location-broker` already handles this. `google-location` description explicitly states the conflict. Consider adding a startup warning if both are enabled.          |
| OAuth state stored in memory is lost on restart                                               | Low — pending auth flows interrupted by restart expire            | This is acceptable — the 10-minute TTL handles cleanup. Users simply start a new flow. No persistent state is needed for pending flows.                                                  |
| Token refresh creates race conditions (multiple simultaneous refreshes)                       | Medium — duplicate token writes, potential vault corruption       | Use a per-account refresh lock (Mutex/Promise-based) in `OAuthManager` to serialize refresh attempts for the same account.                                                               |

## Timeline Estimate

| Step                       | Estimate       | Notes                                                     |
| -------------------------- | -------------- | --------------------------------------------------------- |
| Step 1: Install deps       | 15 min         | Straightforward npm install                               |
| Step 2: account-store.ts   | 2-3 hrs        | Vault interaction, startup scan, multi-account state      |
| Step 3: oauth-manager.ts   | 3-4 hrs        | OAuth flow, token lifecycle, refresh lock, error handling |
| Step 4: google-apis.ts     | 2-3 hrs        | Plugin wiring, REST routes, lifecycle hooks               |
| Step 5: Web UI             | 2-3 hrs        | React component, CSS, OAuth callback UX                   |
| Step 6: google-location.ts | 1-2 hrs        | Simple provider bridge                                    |
| Step 7: Plugin registry    | 30 min         | JSON edits                                                |
| Step 8: Config scaffold    | 30 min         | JSON stubs                                                |
| Step 9: Unit tests         | 3-4 hrs        | Comprehensive test coverage                               |
| Step 10: Build/lint/fix    | 1-2 hrs        | Integration verification                                  |
| **Total**                  | **~16-22 hrs** | Assumes familiarity with the plugin system                |

Assumptions:

- Developer is familiar with A.L.I.C.E. plugin architecture
- Google Cloud project and OAuth credentials are available for testing
- `@googleapis/*` packages work as documented (no surprise API changes)
- No major esbuild configuration changes needed for the new packages (they're server-side only, not bundled into the client)
