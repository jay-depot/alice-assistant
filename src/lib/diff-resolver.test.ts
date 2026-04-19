import { describe, it, expect } from 'vitest';
import { resolveContents } from './diff-resolver.js';

describe('resolveContents', () => {
  describe('format: full', () => {
    it('returns contents as-is', () => {
      const result = resolveContents('original text', 'full', 'new text');
      expect(result).toEqual({ ok: true, contents: 'new text' });
    });

    it('returns original when contents is empty string', () => {
      const result = resolveContents('original text', 'full', '');
      expect(result).toEqual({ ok: true, contents: '' });
    });

    it('works with multiline contents', () => {
      const multiline = 'line1\nline2\nline3';
      const result = resolveContents('original', 'full', multiline);
      expect(result).toEqual({ ok: true, contents: multiline });
    });
  });

  describe('format: diff', () => {
    it('applies a simple line replacement patch', () => {
      const original = 'Hello World';
      const patch =
        '--- original\n+++ modified\n@@ -1 +1 @@\n-Hello World\n+Hello World!';
      const result = resolveContents(original, 'diff', patch);
      if (!result.ok) throw new Error('Expected ok=true');
      expect(result.contents).toBe('Hello World!');
    });

    it('applies a patch that adds lines', () => {
      const original = 'line1\nline2';
      const patch =
        '--- original\n+++ modified\n@@ -1,2 +1,3 @@\n line1\n line2\n+line3';
      const result = resolveContents(original, 'diff', patch);
      if (!result.ok) throw new Error('Expected ok=true');
      expect(result.contents).toBe('line1\nline2\nline3');
    });

    it('applies a patch that removes lines', () => {
      const original = 'line1\nline2\nline3';
      const patch =
        '--- original\n+++ modified\n@@ -1,3 +1,2 @@\n line1\n-line2\n line3';
      const result = resolveContents(original, 'diff', patch);
      if (!result.ok) throw new Error('Expected ok=true');
      expect(result.contents).toBe('line1\nline3');
    });

    it('creates content from empty original', () => {
      const patch =
        '--- original\n+++ modified\n@@ -0,0 +1,2 @@\n+line1\n+line2';
      const result = resolveContents('', 'diff', patch);
      if (!result.ok) throw new Error('Expected ok=true');
      // applyPatch may add a trailing newline when applied to empty string
      expect(result.contents).toMatch(/^line1\nline2\n?$/);
    });

    it('returns soft error for empty patch', () => {
      const result = resolveContents('some content', 'diff', '');
      if (result.ok) throw new Error('Expected ok=false');
      expect(result.reason).toBe('empty_patch');
    });

    it('returns soft error for whitespace-only patch', () => {
      const result = resolveContents('some content', 'diff', '   \n  \t  ');
      if (result.ok) throw new Error('Expected ok=false');
      expect(result.reason).toBe('empty_patch');
    });

    it('returns soft error for unparseable diff', () => {
      const result = resolveContents(
        'original',
        'diff',
        'this is not a diff at all'
      );
      if (result.ok) throw new Error('Expected ok=false');
      // parsePatch accepts nearly anything but returns patches with no hunks
      expect(result.reason).toBe('empty_patch');
    });

    it('returns soft error for malformed hunk', () => {
      const result = resolveContents(
        'original',
        'diff',
        '--- a\n+++ b\n@@ -invalid\n@@'
      );
      if (result.ok) throw new Error('Expected ok=false');
      expect(result.reason).toBe('parse_error');
    });
  });
});
