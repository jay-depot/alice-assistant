/**
 * @file redactor.ts
 *
 * Secrets redactor for A.L.I.C.E. Assistant.
 *
 * Two-part redaction system:
 *   1. Exact-match redaction: removes any string that exactly matches a secret
 *      stored in the credential vault.
 *   2. Pattern-based redaction: detects common credential patterns (AWS keys,
 *      generic API keys, PEM private keys, URL-embedded credentials).
 *
 * The redactor is designed to be used by plugins that handle user-facing content
 * (primarily the user-files plugin) before returning content to the LLM.
 */

import { listSecretKeys, retrieveSecret } from './vault.js';

/**
 * Redaction result for a single match.
 */
export type RedactionMatch = {
  /** The key name that was redacted (for exact-match) or the pattern type (for pattern-match) */
  label: string;
  /** The type of redaction that occurred */
  type: 'exact' | 'pattern';
};

/**
 * A compiled pattern for the pattern-based redactor.
 */
type CompiledPattern = {
  /** Human-readable label for this pattern type */
  label: string;
  /** The regex pattern to match */
  pattern: RegExp;
  /** The replacement string */
  replacement: string;
};

/**
 * Pattern-based redaction rules.
 *
 * These detect common credential formats that might appear in file content
 * even if they're not stored in the vault.
 */
const CREDENTIAL_PATTERNS: CompiledPattern[] = [
  // AWS Access Key IDs (AKIA followed by 16 uppercase alphanumeric chars)
  {
    label: 'aws-access-key-id',
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED: aws-access-key-id]',
  },
  // AWS Secret Access Keys (40-char base64-ish strings after known AWS key context)
  // This is a heuristic — 40-char strings that look like base64 near AWS-related keywords
  {
    label: 'aws-secret-key',
    pattern:
      /(?:aws_secret_access_key|aws_secret_key|secret_key)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    replacement: '[REDACTED: aws-secret-key]',
  },
  // PEM private key blocks
  {
    label: 'private-key',
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    replacement: '[REDACTED: private-key]',
  },
  // URL-embedded credentials: ://user:pass@host
  {
    label: 'url-credentials',
    pattern: /:\/\/([^:@\s]+):([^@\s]+)@/g,
    replacement: '://[REDACTED: url-credentials]@',
  },
  // Generic API key / token patterns: keyword followed by a long alphanumeric string
  // Matches patterns like api_key=XXXX, token: XXXX, Bearer XXXX, etc.
  {
    label: 'api-key',
    pattern:
      /(?:(?:api[_-]?key|apikey|api[_-]?secret|access[_-]?key|secret[_-]?key|auth[_-]?token|bearer|authorization)\s*[=:]\s*["']?)([A-Za-z0-9+/=_-]{32,})["']?/gi,
    replacement: '[REDACTED: api-key]',
  },
];

/**
 * Secrets redactor that combines exact-match and pattern-based redaction.
 *
 * Usage:
 *   const redactor = new SecretsRedactor();
 *   await redactor.refreshFromVault();
 *   const safe = redactor.redact(someText);
 */
export class SecretsRedactor {
  private exactSecrets: Map<string, string> = new Map(); // secret value → key name
  private vaultRefreshed = false;

  /**
   * Loads all secret values from the vault and builds the exact-match set.
   * Should be called once at startup and after any vault modification.
   */
  async refreshFromVault(): Promise<void> {
    this.exactSecrets.clear();

    try {
      const keys = listSecretKeys();
      for (const key of keys) {
        const value = retrieveSecret(key);
        if (value !== undefined) {
          this.exactSecrets.set(value, key);
        }
      }
      this.vaultRefreshed = true;
    } catch {
      // If the vault can't be read (e.g., wrong encryption key), skip exact-match
      // redaction but still allow pattern-based redaction.
      this.vaultRefreshed = false;
    }
  }

  /**
   * Adds a secret to the exact-match redaction set directly.
   * Useful for testing or for secrets that aren't in the vault.
   */
  addExactSecret(key: string, value: string): void {
    this.exactSecrets.set(value, key);
  }

  /**
   * Redacts secrets from the given text.
   *
   * First applies exact-match redaction (replacing any vault secret value
   * with [REDACTED:key-name]), then applies pattern-based redaction.
   *
   * @param text The text to redact.
   * @returns The redacted text.
   */
  redact(text: string): string {
    let result = text;

    // Phase 1: Exact-match redaction
    // Sort by length (longest first) to avoid partial matches
    const sortedSecrets = [...this.exactSecrets.entries()].sort(
      (a, b) => b[0].length - a[0].length
    );

    for (const [secretValue, keyName] of sortedSecrets) {
      // Use split/join for global replacement to avoid regex special character issues
      if (result.includes(secretValue)) {
        result = result.split(secretValue).join(`[REDACTED: ${keyName}]`);
      }
    }

    // Phase 2: Pattern-based redaction
    for (const { pattern, replacement } of CREDENTIAL_PATTERNS) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement);
    }

    return result;
  }

  /**
   * Returns whether the vault has been successfully refreshed.
   * If false, only pattern-based redaction is active.
   */
  get isVaultLoaded(): boolean {
    return this.vaultRefreshed;
  }

  /**
   * Returns the number of exact-match secrets currently loaded.
   */
  get exactSecretCount(): number {
    return this.exactSecrets.size;
  }
}
