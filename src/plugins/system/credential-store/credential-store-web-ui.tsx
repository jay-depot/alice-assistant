/**
 * @file credential-store-web-ui.tsx
 *
 * Web UI component for the Credential Store plugin.
 * Provides a page for managing credentials stored in the encrypted vault.
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
    'Credential Store web UI extension requires globalThis.React to be available.'
  );
}

const { useState, useEffect, useCallback, createElement: h } = React;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VaultStatus = {
  initialized: boolean;
  keyCount: number;
  readable: boolean;
  permissionsOk: boolean;
  permissionsMode?: string;
  vaultPath: string;
  error?: string;
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchStatus(): Promise<VaultStatus> {
  const res = await fetch('/api/credentials/status');
  if (!res.ok)
    throw new Error(`Failed to fetch vault status: ${res.statusText}`);
  return res.json();
}

async function fetchKeys(): Promise<string[]> {
  const res = await fetch('/api/credentials');
  if (!res.ok)
    throw new Error(`Failed to fetch credential keys: ${res.statusText}`);
  const data = await res.json();
  return data.keys;
}

async function storeCredential(key: string, value: string): Promise<void> {
  const res = await fetch('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      data.error || `Failed to store credential: ${res.statusText}`
    );
  }
}

async function deleteCredential(key: string): Promise<void> {
  const res = await fetch(`/api/credentials/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
  if (!res.ok)
    throw new Error(`Failed to delete credential: ${res.statusText}`);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function StatusIndicator({ status }: { status: VaultStatus | null }) {
  if (!status) return null;

  return h(
    'div',
    { className: 'cs-status' },
    h('h3', null, 'Vault Status'),
    h(
      'div',
      { className: 'cs-status-grid' },
      h('span', { className: 'cs-status-label' }, 'Initialized:'),
      h('span', null, status.initialized ? '✓ Yes' : '✗ No'),
      h('span', { className: 'cs-status-label' }, 'Readable:'),
      h('span', null, status.readable ? '✓ Yes' : '✗ No'),
      h('span', { className: 'cs-status-label' }, 'Credentials:'),
      h('span', null, `${status.keyCount} stored`),
      h('span', { className: 'cs-status-label' }, 'Permissions:'),
      h(
        'span',
        null,
        status.permissionsOk
          ? '✓ Secure'
          : `⚠ ${status.permissionsMode || 'Insecure'}`
      ),
      status.error
        ? h('div', { className: 'cs-error' }, `⚠ ${status.error}`)
        : null
    )
  );
}

function AddCredentialForm({ onAdded }: { onAdded: () => void }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!key.trim() || !value.trim()) return;

      setSaving(true);
      setError(null);
      setSuccess(null);

      try {
        await storeCredential(key.trim(), value.trim());
        setSuccess(`Credential "${key.trim()}" stored successfully.`);
        setKey('');
        setValue('');
        onAdded();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to store credential.'
        );
      } finally {
        setSaving(false);
      }
    },
    [key, value, onAdded]
  );

  return h(
    'div',
    { className: 'cs-add-form' },
    h('h3', null, 'Add Credential'),
    h(
      'form',
      { onSubmit: handleSubmit },
      h(
        'div',
        { className: 'cs-form-group' },
        h('label', { htmlFor: 'cs-key' }, 'Key (e.g., moltbook.api_key)'),
        h('input', {
          id: 'cs-key',
          type: 'text',
          value: key,
          onChange: e => setKey(e.target.value),
          placeholder: 'plugin-name.secret-name',
          required: true,
          disabled: saving,
        })
      ),
      h(
        'div',
        { className: 'cs-form-group' },
        h('label', { htmlFor: 'cs-value' }, 'Value'),
        h(
          'div',
          { className: 'cs-value-input' },
          h('input', {
            id: 'cs-value',
            type: showValue ? 'text' : 'password',
            value: value,
            onChange: e => setValue(e.target.value),
            placeholder: 'Enter the secret value',
            required: true,
            disabled: saving,
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'cs-toggle-visibility',
              onClick: () => setShowValue(!showValue),
              title: showValue ? 'Hide value' : 'Show value',
            },
            showValue ? '🙈' : '👁'
          )
        )
      ),
      h(
        'button',
        {
          type: 'submit',
          className: 'cs-btn cs-btn-primary',
          disabled: saving || !key.trim() || !value.trim(),
        },
        saving ? 'Storing...' : 'Store Credential'
      ),
      error ? h('div', { className: 'cs-error' }, error) : null,
      success ? h('div', { className: 'cs-success' }, success) : null
    )
  );
}

function CredentialList({
  keys,
  onDeleted,
}: {
  keys: string[];
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const handleDelete = useCallback(
    async (key: string) => {
      setDeleting(key);
      try {
        await deleteCredential(key);
        setConfirmKey(null);
        onDeleted();
      } catch {
        // Error will be visible from the key still being in the list
      } finally {
        setDeleting(null);
      }
    },
    [onDeleted]
  );

  if (keys.length === 0) {
    return h(
      'div',
      { className: 'cs-empty' },
      h('p', null, 'No credentials stored in the vault.'),
      h(
        'p',
        { className: 'cs-hint' },
        'Use the form above to add a credential, or ask the assistant to use the manageCredentials tool.'
      )
    );
  }

  return h(
    'div',
    { className: 'cs-credential-list' },
    h('h3', null, 'Stored Credentials'),
    h(
      'ul',
      { className: 'cs-key-list' },
      ...keys.sort().map(key =>
        h(
          'li',
          { key, className: 'cs-key-item' },
          h('span', { className: 'cs-key-name' }, key),
          h(
            'div',
            { className: 'cs-key-actions' },
            confirmKey === key
              ? h(
                  'div',
                  { className: 'cs-confirm-delete' },
                  h('span', null, 'Delete this credential?'),
                  h(
                    'button',
                    {
                      className: 'cs-btn cs-btn-danger',
                      onClick: () => handleDelete(key),
                      disabled: deleting === key,
                    },
                    deleting === key ? 'Deleting...' : 'Yes, Delete'
                  ),
                  h(
                    'button',
                    {
                      className: 'cs-btn cs-btn-secondary',
                      onClick: () => setConfirmKey(null),
                      disabled: deleting === key,
                    },
                    'Cancel'
                  )
                )
              : h(
                  'button',
                  {
                    className: 'cs-btn cs-btn-danger cs-btn-small',
                    onClick: () => setConfirmKey(key),
                    disabled: deleting !== null,
                  },
                  'Delete'
                )
          )
        )
      )
    )
  );
}

function CredentialManagerPage() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [newStatus, newKeys] = await Promise.all([
        fetchStatus(),
        fetchKeys(),
      ]);
      setStatus(newStatus);
      setKeys(newKeys);
    } catch (err) {
      console.error('Failed to refresh credential store:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return h(
      'div',
      { className: 'cs-page' },
      h('h2', null, '🔒 Credential Store'),
      h('p', null, 'Loading...')
    );
  }

  return h(
    'div',
    { className: 'cs-page' },
    h('h2', null, '🔒 Credential Store'),
    h(
      'p',
      { className: 'cs-description' },
      'Manage credentials stored in the encrypted vault. ' +
        'Values are encrypted and never displayed. ' +
        'Use the manageCredentials tool or this page to store and manage API keys, tokens, and other secrets.'
    ),
    h(StatusIndicator, { status }),
    h(AddCredentialForm, { onAdded: refresh }),
    h(CredentialList, { keys, onDeleted: refresh })
  );
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

const CredentialStoreWebUI: PluginClientExport = {
  routes: [
    {
      path: '/credentials',
      title: 'Credentials',
      component: CredentialManagerPage,
    },
  ],
};

export default CredentialStoreWebUI;
