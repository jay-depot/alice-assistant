import { describe, it, expect, beforeEach } from 'vitest';
import { SecretsRedactor } from './redactor.js';

// Note: The vault and encryption-key modules depend on UserConfig which reads
// from the filesystem. Integration tests for those modules should be run
// separately with a proper config directory setup. The redactor tests here
// are self-contained since SecretsRedactor can be used without the vault.

describe('SecretsRedactor', () => {
  let redactor: SecretsRedactor;

  beforeEach(() => {
    redactor = new SecretsRedactor();
  });

  describe('exact-match redaction', () => {
    it('should redact exact-match secrets', () => {
      redactor.addExactSecret('moltbook.api_key', 'sk-abc123xyz');

      const result = redactor.redact(
        'My API key is sk-abc123xyz and I use it for requests'
      );
      expect(result).toBe(
        'My API key is [REDACTED: moltbook.api_key] and I use it for requests'
      );
    });

    it('should redact all occurrences of a secret', () => {
      redactor.addExactSecret('test.key', 'secret123');

      const result = redactor.redact(
        'secret123 appears here and secret123 appears there'
      );
      expect(result).toBe(
        '[REDACTED: test.key] appears here and [REDACTED: test.key] appears there'
      );
    });

    it('should redact longest match first', () => {
      redactor.addExactSecret('short', 'abc');
      redactor.addExactSecret('long', 'abcdef');

      const result = redactor.redact('The value abcdef contains abc');
      expect(result).toBe(
        'The value [REDACTED: long] contains [REDACTED: short]'
      );
    });

    it('should report vault loaded status', () => {
      expect(redactor.isVaultLoaded).toBe(false);
      expect(redactor.exactSecretCount).toBe(0);

      redactor.addExactSecret('test', 'value');
      expect(redactor.exactSecretCount).toBe(1);
    });
  });

  describe('pattern-based redaction', () => {
    it('should redact AWS access key patterns', () => {
      const result = redactor.redact('AWS key: AKIAIOSFODNN7EXAMPLE');
      expect(result).toContain('[REDACTED: aws-access-key-id]');
      expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('should redact PEM private key blocks', () => {
      const pemKey =
        '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgw\nggSkAgEAAoIBAQC7VJTUt9Us8cKjMFCEf0hU\n-----END PRIVATE KEY-----';
      const result = redactor.redact(`Here is my key:\n${pemKey}\nEnd of key`);
      expect(result).toContain('[REDACTED: private-key]');
      expect(result).not.toContain('MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgw');
    });

    it('should redact RSA private key blocks', () => {
      const pemKey =
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF\n-----END RSA PRIVATE KEY-----';
      const result = redactor.redact(pemKey);
      expect(result).toContain('[REDACTED: private-key]');
    });

    it('should redact URL-embedded credentials', () => {
      const result = redactor.redact(
        'Database URL: postgres://admin:secretpass@db.example.com:5432/mydb'
      );
      expect(result).toContain('[REDACTED: url-credentials]');
      expect(result).not.toContain('admin:secretpass@');
    });

    it('should not false-positive on short strings', () => {
      const result = redactor.redact(
        'The quick brown fox jumps over the lazy dog'
      );
      expect(result).toBe('The quick brown fox jumps over the lazy dog');
    });

    it('should apply both exact-match and pattern redaction', () => {
      redactor.addExactSecret('my.key', 'exact-secret-value');

      const text =
        'My key is exact-secret-value and there is also AKIAIOSFODNN7EXAMPLE';
      const result = redactor.redact(text);
      expect(result).toContain('[REDACTED: my.key]');
      expect(result).toContain('[REDACTED: aws-access-key-id]');
    });
  });
});
