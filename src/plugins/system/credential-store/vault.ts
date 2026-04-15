/**
 * @file vault.ts
 *
 * Encrypted credential vault for A.L.I.C.E. Assistant.
 *
 * The vault is stored as a JSON file at ~/.alice-assistant/credential-vault.json.
 * Each entry is a namespaced key (e.g., "moltbook.api_key") mapping to an encrypted
 * value stored with AES-256-GCM. Each encryption uses a fresh random IV and stores
 * the authentication tag alongside the ciphertext.
 *
 * File permissions are set to 0600 (owner read/write only) as a defense-in-depth
 * measure, since the values are already encrypted at rest.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { UserConfig } from '../../../lib/user-config.js';
import { getEncryptionKey } from './encryption-key.js';

export type VaultEntry = {
  /** Base64-encoded IV (12 bytes for GCM) */
  iv: string;
  /** Base64-encoded ciphertext */
  encrypted: string;
  /** Base64-encoded GCM authentication tag */
  tag: string;
  /** ISO 8601 timestamp when the entry was created */
  createdAt: string;
  /** ISO 8601 timestamp when the entry was last updated */
  updatedAt: string;
};

export type VaultFile = {
  version: number;
  [key: string]: VaultEntry | number;
};

const VAULT_FILENAME = 'credential-vault.json';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM

/**
 * Returns the path to the vault file.
 */
export function getVaultFilePath(): string {
  return path.join(UserConfig.getConfigPath(), VAULT_FILENAME);
}

/**
 * Initializes the vault file if it doesn't exist.
 * Creates the file with `{ version: 1 }` and sets restrictive permissions.
 *
 * @returns The path to the vault file.
 */
export function initializeVault(): string {
  const vaultPath = getVaultFilePath();

  if (!fs.existsSync(vaultPath)) {
    const vault: VaultFile = { version: 1 };
    fs.writeFileSync(vaultPath, JSON.stringify(vault, null, 2), 'utf-8');

    try {
      fs.chmodSync(vaultPath, 0o600);
    } catch {
      // Permissions may not be supported on all platforms; best-effort
    }
  }

  return vaultPath;
}

/**
 * Reads and parses the vault file.
 *
 * @returns The parsed vault file contents.
 * @throws {Error} If the vault file cannot be read or parsed.
 */
export function readVault(): VaultFile {
  const vaultPath = getVaultFilePath();

  if (!fs.existsSync(vaultPath)) {
    return initializeVault() as unknown as VaultFile;
  }

  const content = fs.readFileSync(vaultPath, 'utf-8');
  try {
    return JSON.parse(content) as VaultFile;
  } catch {
    throw new Error(
      `Failed to parse credential vault at ${vaultPath}. The file may be corrupted.`
    );
  }
}

/**
 * Writes the vault data to disk with restrictive permissions.
 */
function writeVault(vault: VaultFile): void {
  const vaultPath = getVaultFilePath();
  fs.writeFileSync(vaultPath, JSON.stringify(vault, null, 2), 'utf-8');

  try {
    fs.chmodSync(vaultPath, 0o600);
  } catch {
    // Best-effort
  }
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * @param plaintext The string to encrypt.
 * @param key The 32-byte encryption key.
 * @returns A VaultEntry containing the encrypted data and metadata.
 */
export function encrypt(plaintext: string, key: Buffer): VaultEntry {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const now = new Date().toISOString();

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    encrypted,
    tag: tag.toString('base64'),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Decrypts a VaultEntry using AES-256-GCM.
 *
 * @param entry The vault entry to decrypt.
 * @param key The 32-byte encryption key.
 * @returns The decrypted plaintext string.
 * @throws {Error} If decryption fails (e.g., wrong key, corrupted data).
 */
export function decrypt(entry: VaultEntry, key: Buffer): string {
  const iv = Buffer.from(entry.iv, 'base64');
  const tag = Buffer.from(entry.tag, 'base64');
  const encrypted = entry.encrypted;

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Stores a secret in the vault. If the key already exists, the value is updated.
 *
 * @param key The namespaced key (e.g., "moltbook.api_key").
 * @param plaintext The secret value to store.
 * @throws {Error} If the encryption key cannot be derived or the vault cannot be written.
 */
export function storeSecret(key: string, plaintext: string): void {
  const encryptionKey = getEncryptionKey();
  const vault = readVault();

  const existing = vault[key];
  const entry = encrypt(plaintext, encryptionKey);

  if (existing && typeof existing === 'object' && 'encrypted' in existing) {
    // Preserve the original createdAt timestamp
    entry.createdAt = (existing as VaultEntry).createdAt;
  }

  vault[key] = entry;
  writeVault(vault);
}

/**
 * Retrieves a secret from the vault.
 *
 * @param key The namespaced key to look up.
 * @returns The decrypted plaintext value, or undefined if the key doesn't exist.
 * @throws {Error} If the key exists but decryption fails (e.g., wrong encryption key).
 */
export function retrieveSecret(key: string): string | undefined {
  const encryptionKey = getEncryptionKey();
  const vault = readVault();

  const entry = vault[key];
  if (!entry || typeof entry === 'number') {
    return undefined;
  }

  return decrypt(entry as VaultEntry, encryptionKey);
}

/**
 * Deletes a secret from the vault.
 *
 * @param key The namespaced key to delete.
 * @returns true if the key existed and was deleted, false if it didn't exist.
 */
export function deleteSecret(key: string): boolean {
  const vault = readVault();

  if (!(key in vault) || typeof vault[key] === 'number') {
    return false;
  }

  delete vault[key];
  writeVault(vault);
  return true;
}

/**
 * Lists all secret key names in the vault.
 *
 * @returns An array of key names (without values).
 */
export function listSecretKeys(): string[] {
  const vault = readVault();
  return Object.keys(vault).filter(
    key => key !== 'version' && typeof vault[key] === 'object'
  );
}

/**
 * Checks whether a secret key exists in the vault.
 *
 * @param key The namespaced key to check.
 * @returns true if the key exists in the vault.
 */
export function hasSecret(key: string): boolean {
  const vault = readVault();
  return key in vault && typeof vault[key] === 'object';
}

/**
 * Checks whether the vault can be decrypted with the current encryption key.
 *
 * This is useful for detecting hardware ID changes that would make the vault
 * unreadable. It attempts to decrypt one entry (if any exist) to verify the
 * key is valid.
 *
 * @returns An object with validation status and details.
 */
export function verifyVaultIntegrity(): {
  vaultExists: boolean;
  vaultReadable: boolean;
  keyCount: number;
  error?: string;
} {
  const vaultPath = getVaultFilePath();

  if (!fs.existsSync(vaultPath)) {
    return { vaultExists: false, vaultReadable: true, keyCount: 0 };
  }

  let vault: VaultFile;
  try {
    vault = readVault();
  } catch (err) {
    return {
      vaultExists: true,
      vaultReadable: false,
      keyCount: 0,
      error: `Failed to read vault: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const keys = listSecretKeys();
  if (keys.length === 0) {
    return { vaultExists: true, vaultReadable: true, keyCount: 0 };
  }

  // Try to decrypt the first entry to verify the key
  try {
    const encryptionKey = getEncryptionKey();
    const firstKey = keys[0]!;
    const entry = vault[firstKey] as VaultEntry;
    decrypt(entry, encryptionKey);
    return { vaultExists: true, vaultReadable: true, keyCount: keys.length };
  } catch (err) {
    return {
      vaultExists: true,
      vaultReadable: false,
      keyCount: keys.length,
      error: `Vault decryption failed. This usually means the hardware identifier has changed (e.g., NIC replacement or OS reinstall). Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Checks whether the vault file has appropriate permissions.
 *
 * @returns An object indicating whether permissions are restrictive enough.
 */
export function checkVaultPermissions(): {
  ok: boolean;
  mode?: string;
  path: string;
} {
  const vaultPath = getVaultFilePath();

  if (!fs.existsSync(vaultPath)) {
    return { ok: true, path: vaultPath };
  }

  try {
    const stats = fs.statSync(vaultPath);
    const mode = (stats.mode & 0o777).toString(8);
    // Check if group or others have any permissions
    const hasGroupOrOtherAccess = (stats.mode & 0o077) !== 0;
    return { ok: !hasGroupOrOtherAccess, mode, path: vaultPath };
  } catch {
    return { ok: false, path: vaultPath };
  }
}
