/**
 * @file alice-id.ts
 *
 * Generates and persists a unique numeric "Alice ID" used as part of the
 * encryption key for the credential vault. The Alice ID is created once and
 * stored in ~/.alice-assistant/alice-id.json. If the file already exists, the
 * existing ID is returned.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { UserConfig } from '../../../lib/user-config.js';

export type AliceIdFile = {
  aliceId: string;
  createdAt: string;
};

const ALICE_ID_FILENAME = 'alice-id.json';

/**
 * Returns the path to the Alice ID file.
 */
export function getAliceIdFilePath(): string {
  const configDir = UserConfig.getConfigPath();
  return path.join(configDir, ALICE_ID_FILENAME);
}

/**
 * Generates a new random numeric Alice ID.
 *
 * The ID is a string of digits derived from 16 random bytes, encoded as a
 * decimal integer. This provides ~128 bits of entropy.
 */
function generateAliceId(): string {
  const bytes = randomBytes(16);
  // Convert to a BigInt to avoid precision loss, then to decimal string
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return BigInt('0x' + hex).toString(10);
}

/**
 * Loads or creates the Alice ID file.
 *
 * If the file exists, reads and returns the stored Alice ID.
 * If the file does not exist, generates a new Alice ID, saves it, and returns it.
 *
 * @throws {Error} If the file exists but cannot be parsed, or if writing fails.
 */
export function getOrCreateAliceId(): AliceIdFile {
  const filePath = getAliceIdFilePath();

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    try {
      const parsed: AliceIdFile = JSON.parse(content);
      if (!parsed.aliceId || typeof parsed.aliceId !== 'string') {
        throw new Error(
          'Alice ID file is missing or has an invalid aliceId field.'
        );
      }
      return parsed;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Failed to parse Alice ID file at ${filePath}`, {
          cause: err,
        });
      }
      throw err;
    }
  }

  // Generate and save a new Alice ID
  const aliceIdFile: AliceIdFile = {
    aliceId: generateAliceId(),
    createdAt: new Date().toISOString(),
  };

  const configDir = UserConfig.getConfigPath();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(aliceIdFile, null, 2), 'utf-8');

  // Set restrictive permissions (owner read/write only)
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Permissions may not be supported on all platforms; best-effort
  }

  return aliceIdFile;
}
