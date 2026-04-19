import { applyPatch, parsePatch } from 'diff';
import { systemLogger } from './system-logger.js';

export type UpdateFormat = 'full' | 'diff';

export type ResolveResult =
  | { ok: true; contents: string }
  | {
      ok: false;
      reason: 'empty_patch' | 'parse_error' | 'apply_error';
      message: string;
    };

/**
 * Resolve new contents from original + update payload.
 *
 * - `format: 'full'`: `contents` is the complete new text, returned as-is
 * - `format: 'diff'`: `contents` is a unified diff patch; applied to `original`
 *
 * Soft errors (empty patch, parse failure, apply failure) are logged to console
 * and returned as `{ ok: false, ... }` so the tool layer can tell the LLM to
 * retry with `format: 'full'`.
 */
export function resolveContents(
  original: string,
  format: UpdateFormat,
  contents: string
): ResolveResult {
  if (format === 'full') {
    return { ok: true, contents };
  }

  // format === 'diff'
  if (!contents.trim()) {
    const msg = 'LLM provided an empty diff patch.';
    systemLogger.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'empty_patch', message: msg };
  }

  let patches;
  try {
    patches = parsePatch(contents);
  } catch (e) {
    const msg = `LLM generated an unparseable diff: ${
      e instanceof Error ? e.message : String(e)
    }`;
    systemLogger.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'parse_error', message: msg };
  }

  if (patches.length === 0) {
    const msg = 'LLM provided an empty diff patch.';
    systemLogger.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'empty_patch', message: msg };
  }

  const hasAnyHunks = patches.some(p => p.hunks && p.hunks.length > 0);
  if (!hasAnyHunks) {
    const msg = 'LLM generated a diff with no changes.';
    systemLogger.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'empty_patch', message: msg };
  }

  let result = original;
  try {
    for (const patch of patches) {
      result = applyPatch(result, patch);
    }
  } catch (e) {
    const msg = `Diff apply failed: ${e instanceof Error ? e.message : String(e)}`;
    systemLogger.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'apply_error', message: msg };
  }

  return { ok: true, contents: result };
}
