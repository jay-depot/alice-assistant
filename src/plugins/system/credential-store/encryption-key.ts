/**
 * @file encryption-key.ts
 *
 * Derives the AES-256-GCM encryption key for the credential vault.
 *
 * The key is derived from:
 *   SHA-256(aliceId + hardwareId)
 *
 * Where:
 *   - aliceId: the unique numeric ID stored in ~/.alice-assistant/alice-id.json
 *   - hardwareId: on Linux, the contents of /etc/machine-id;
 *                 on other platforms, the first non-internal MAC address
 *
 * The derived key is cached in memory and never written to disk.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { getOrCreateAliceId } from './alice-id.js';

let cachedKey: Buffer | undefined;

/**
 * Reads the hardware identifier for the current machine.
 *
 * On Linux, reads /etc/machine-id.
 * On other platforms, finds the first non-internal MAC address from os.networkInterfaces().
 *
 * @returns The hardware identifier string, or an empty string if unavailable.
 */
export function getHardwareId(): string {
  if (process.platform === 'linux') {
    try {
      const machineId = fs.readFileSync('/etc/machine-id', 'utf-8').trim();
      if (machineId.length > 0) {
        return machineId;
      }
    } catch {
      // Fall through to MAC address fallback
    }
  }

  // MAC address fallback: find the first non-internal interface with a MAC
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const entries = interfaces[name];
    if (!entries) continue;
    for (const entry of entries) {
      // Skip internal/loopback interfaces and entries without a MAC
      if (entry.internal) continue;
      if (!entry.mac || entry.mac === '00:00:00:00:00:00') continue;
      return entry.mac;
    }
  }

  // Last resort: use hostname
  return os.hostname();
}

/**
 * Derives the AES-256 encryption key from the Alice ID and hardware identifier.
 *
 * The key is computed as SHA-256(aliceId + hardwareId) and cached for the
 * lifetime of the process.
 *
 * @returns A 32-byte Buffer suitable for AES-256-GCM encryption.
 * @throws {Error} If the Alice ID cannot be loaded or the key cannot be derived.
 */
export function getEncryptionKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const aliceIdFile = getOrCreateAliceId();
  const hardwareId = getHardwareId();

  if (!hardwareId) {
    throw new Error(
      'Cannot derive encryption key: no hardware identifier available. ' +
        'Ensure /etc/machine-id exists (Linux) or a network interface is available.'
    );
  }

  const combined = aliceIdFile.aliceId + hardwareId;
  cachedKey = createHash('sha256').update(combined).digest();

  return cachedKey;
}

/**
 * Clears the cached encryption key. Used primarily for testing.
 */
export function clearCachedKey(): void {
  cachedKey = undefined;
}
