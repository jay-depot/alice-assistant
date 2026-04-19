/**
 * @file google-apis-web-ui.tsx
 *
 * Web UI component for managing Google accounts.
 * Provides a page for connecting/disconnecting Google accounts,
 * configuring OAuth credentials, and viewing account status.
 *
 * This file is built with esbuild into a standalone JS bundle that runs
 * in the browser. It uses globalThis.React instead of importing React,
 * since React is provided by the host web-ui bundle.
 */

import type { PluginClientExport } from '../../system/web-ui/client/types/index.js';

type ReactModule = typeof import('react');

const React = (globalThis as typeof globalThis & { React?: ReactModule }).React;

if (!React) {
  throw new Error(
    'Google APIs web UI extension requires globalThis.React to be available.'
  );
}

const { useState, useEffect, useCallback } = React;
const h = React.createElement;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AccountInfo = {
  accountId: string;
  email: string | null;
  displayName: string | null;
  isAuthenticated: boolean;
  lastRefreshedAt: string | null;
};

type ConfigInfo = {
  hasDefaultCredentials: boolean;
  clientIdPreview: string | null;
  redirectUri: string;
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchAccounts(): Promise<{ accounts: AccountInfo[] }> {
  const res = await fetch('/api/google-apis/accounts');
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.statusText}`);
  return res.json();
}

async function fetchConfig(): Promise<ConfigInfo> {
  const res = await fetch('/api/google-apis/config');
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.statusText}`);
  return res.json();
}

async function initiateFlow(
  accountId: string
): Promise<{ consentUrl: string; accountId: string }> {
  const res = await fetch('/api/google-apis/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      data.error || `Failed to initiate OAuth flow: ${res.statusText}`
    );
  }
  return res.json();
}

async function disconnectAccount(accountId: string): Promise<void> {
  const res = await fetch(
    `/api/google-apis/accounts/${encodeURIComponent(accountId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      data.error || `Failed to disconnect account: ${res.statusText}`
    );
  }
}

async function saveConfig(
  clientId: string,
  clientSecret: string
): Promise<void> {
  const res = await fetch('/api/google-apis/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `Failed to save config: ${res.statusText}`);
  }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function OAuthConfigSection({
  config,
  onConfigSaved,
}: {
  config: ConfigInfo | null;
  onConfigSaved: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveConfig(clientId.trim(), clientSecret.trim());
      setSuccess('OAuth client credentials saved successfully.');
      setClientId('');
      setClientSecret('');
      onConfigSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save credentials.'
      );
    } finally {
      setSaving(false);
    }
  }, [clientId, clientSecret, onConfigSaved]);

  return h(
    'div',
    { className: 'plugin-card' },
    h('h3', null, '⚙️ OAuth Client Configuration'),
    h(
      'p',
      { className: 'plugin-page__description' },
      'To connect Google accounts, you need OAuth credentials from the ',
      h(
        'a',
        {
          href: 'https://console.cloud.google.com/apis/credentials',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        'Google Cloud Console'
      ),
      '. Create a project, then create an OAuth 2.0 Client ID (type: Web application). ' +
        'Add the redirect URI shown below as an authorized redirect URI.'
    ),
    h(
      'div',
      { className: 'ga-api-links' },
      h('h4', null, 'Required APIs'),
      h(
        'p',
        { className: 'plugin-page__description' },
        'Enable these APIs in your Google Cloud project:'
      ),
      h(
        'ul',
        { className: 'plugin-link-list' },
        h(
          'li',
          null,
          h(
            'a',
            {
              href: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            'Gmail API'
          ),
          ' — Read, send, and search email'
        ),
        h(
          'li',
          null,
          h(
            'a',
            {
              href: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            'Google Calendar API'
          ),
          ' — View and manage calendar events'
        ),
        h(
          'li',
          null,
          h(
            'a',
            {
              href: 'https://console.cloud.google.com/apis/library/people.googleapis.com',
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            'People API'
          ),
          ' — Access contacts and profile info'
        )
      )
    ),
    config
      ? h(
          'p',
          { className: 'plugin-hint' },
          h('strong', null, 'Redirect URI: '),
          h('code', null, config.redirectUri)
        )
      : null,
    config?.hasDefaultCredentials
      ? h(
          'p',
          { className: 'plugin-hint plugin-hint--success' },
          '✓ Default OAuth credentials are configured.'
        )
      : null,
    h(
      'div',
      { className: 'plugin-form-group' },
      h('label', { htmlFor: 'ga-client-id' }, 'Client ID'),
      h('input', {
        id: 'ga-client-id',
        type: 'text',
        value: clientId,
        onChange: e => setClientId(e.target.value),
        placeholder: 'xxxxxxxxxxxx.apps.googleusercontent.com',
        disabled: saving,
      })
    ),
    h(
      'div',
      { className: 'plugin-form-group' },
      h('label', { htmlFor: 'ga-client-secret' }, 'Client Secret'),
      h('input', {
        id: 'ga-client-secret',
        type: 'password',
        value: clientSecret,
        onChange: e => setClientSecret(e.target.value),
        placeholder: 'GOCSPX-xxxxxxxxxxxxxxxx',
        disabled: saving,
      })
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'plugin-btn plugin-btn--primary',
        onClick: handleSave,
        disabled: saving || !clientId.trim() || !clientSecret.trim(),
      },
      saving ? 'Saving...' : 'Save Credentials'
    ),
    error
      ? h('div', { className: 'plugin-msg plugin-msg--error' }, error)
      : null,
    success
      ? h('div', { className: 'plugin-msg plugin-msg--success' }, success)
      : null
  );
}

function AccountList({
  accounts,
  onDisconnected,
}: {
  accounts: AccountInfo[];
  onDisconnected: () => void;
}) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDisconnect = useCallback(
    async (accountId: string) => {
      setDisconnecting(accountId);
      setError(null);
      try {
        await disconnectAccount(accountId);
        setConfirmId(null);
        onDisconnected();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to disconnect account.'
        );
      } finally {
        setDisconnecting(null);
      }
    },
    [onDisconnected]
  );

  if (accounts.length === 0) {
    return h(
      'div',
      { className: 'plugin-empty' },
      h('p', null, 'No Google accounts connected.'),
      h(
        'p',
        { className: 'plugin-hint' },
        'Use the form below to connect a Google account.'
      )
    );
  }

  return h(
    'div',
    { className: 'plugin-card' },
    h('h3', null, '📋 Connected Accounts'),
    h(
      'ul',
      { className: 'ga-account-list' },
      ...accounts.map(account =>
        h(
          'li',
          { key: account.accountId, className: 'ga-account-item' },
          h(
            'div',
            { className: 'ga-account-info' },
            h(
              'div',
              { className: 'ga-account-name' },
              account.displayName || account.accountId
            ),
            account.email
              ? h('div', { className: 'ga-account-email' }, account.email)
              : null,
            h(
              'div',
              { className: 'ga-account-status' },
              account.isAuthenticated
                ? h(
                    'span',
                    { className: 'plugin-status plugin-status--success' },
                    '✓ Authenticated'
                  )
                : h(
                    'span',
                    { className: 'plugin-status plugin-status--error' },
                    '✗ Not authenticated'
                  ),
              account.lastRefreshedAt
                ? h(
                    'span',
                    { className: 'ga-account-refreshed' },
                    ` · Last refreshed: ${new Date(account.lastRefreshedAt).toLocaleString()}`
                  )
                : null
            )
          ),
          h(
            'div',
            { className: 'ga-account-actions' },
            confirmId === account.accountId
              ? h(
                  'div',
                  { className: 'ga-confirm-disconnect' },
                  h('span', null, 'Disconnect?'),
                  h(
                    'button',
                    {
                      className: 'plugin-btn plugin-btn--danger',
                      onClick: () => handleDisconnect(account.accountId),
                      disabled: disconnecting !== null,
                    },
                    disconnecting === account.accountId
                      ? 'Disconnecting...'
                      : 'Yes, Disconnect'
                  ),
                  h(
                    'button',
                    {
                      className: 'plugin-btn plugin-btn--secondary',
                      onClick: () => setConfirmId(null),
                      disabled: disconnecting !== null,
                    },
                    'Cancel'
                  )
                )
              : h(
                  'button',
                  {
                    className:
                      'plugin-btn plugin-btn--danger plugin-btn--small',
                    onClick: () => setConfirmId(account.accountId),
                    disabled: disconnecting !== null,
                  },
                  'Disconnect'
                )
          )
        )
      )
    ),
    error
      ? h('div', { className: 'plugin-msg plugin-msg--error' }, error)
      : null
  );
}

function AddAccountSection() {
  const [accountId, setAccountId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    if (!accountId.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      const result = await initiateFlow(accountId.trim());
      // Redirect the browser to the Google consent page
      window.location.href = result.consentUrl;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to start OAuth flow.'
      );
    } finally {
      setConnecting(false);
    }
  }, [accountId]);

  return h(
    'div',
    { className: 'plugin-card' },
    h('h3', null, '➕ Add Google Account'),
    h(
      'p',
      { className: 'plugin-page__description' },
      'Enter an account ID (e.g., "work" or "personal") to identify this Google account. ' +
        'You will be redirected to Google to grant permission.'
    ),
    h(
      'div',
      { className: 'plugin-form-group' },
      h('label', { htmlFor: 'ga-account-id' }, 'Account ID'),
      h('input', {
        id: 'ga-account-id',
        type: 'text',
        value: accountId,
        onChange: e => setAccountId(e.target.value),
        placeholder: 'e.g., work, personal',
        disabled: connecting,
        pattern: '[a-zA-Z0-9_-]+',
      })
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'plugin-btn plugin-btn--primary',
        onClick: handleConnect,
        disabled:
          connecting ||
          !accountId.trim() ||
          !/^[a-zA-Z0-9_-]+$/.test(accountId),
      },
      connecting ? 'Connecting...' : 'Connect Account'
    ),
    error
      ? h('div', { className: 'plugin-msg plugin-msg--error' }, error)
      : null
  );
}

function GoogleApisManagerPage() {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Check for OAuth callback params in the URL on page load
  const [callbackMessage, setCallbackMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [accountsData, configData] = await Promise.all([
        fetchAccounts(),
        fetchConfig(),
      ]);
      setAccounts(accountsData.accounts);
      setConfig(configData);
    } catch (err) {
      console.error('Failed to refresh Google APIs data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check URL params for OAuth callback status
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('error');

    if (connected) {
      const email = params.get('email') || connected;
      setCallbackMessage({
        type: 'success',
        text: `Account "${connected}" (${email}) connected successfully!`,
      });
      // Clean up the URL
      window.history.replaceState({}, '', '/google-apis');
    } else if (error) {
      setCallbackMessage({
        type: 'error',
        text: `OAuth error: ${decodeURIComponent(error)}`,
      });
      window.history.replaceState({}, '', '/google-apis');
    }

    refresh();
  }, [refresh]);

  if (loading) {
    return h(
      'div',
      { className: 'plugin-page ga-page' },
      h('h2', { className: 'plugin-page__title' }, '🔗 Google APIs'),
      h('p', null, 'Loading...')
    );
  }

  return h(
    'div',
    { className: 'plugin-page ga-page' },
    h('h2', { className: 'plugin-page__title' }, '🔗 Google APIs'),
    h(
      'p',
      { className: 'plugin-page__description' },
      'Manage Google account connections for Gmail, Calendar, and People API access. ' +
        'Connect one or more Google accounts to enable Google API features.'
    ),
    callbackMessage
      ? h(
          'div',
          {
            className:
              callbackMessage.type === 'success'
                ? 'plugin-msg--banner plugin-msg--success'
                : 'plugin-msg--banner plugin-msg--error',
          },
          callbackMessage.text
        )
      : null,
    h(OAuthConfigSection, { config, onConfigSaved: refresh }),
    h(AccountList, { accounts, onDisconnected: refresh }),
    h(AddAccountSection, null)
  );
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

const GoogleApisWebUI: PluginClientExport = {
  routes: [
    {
      path: '/google-apis',
      title: 'Google APIs',
      component: GoogleApisManagerPage,
    },
  ],
};

export default GoogleApisWebUI;
