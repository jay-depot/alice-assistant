import { applyPatch, parsePatch } from 'diff';
import { systemLogger } from './system-logger.js';

export type UpdateFormat = 'full' | 'diff';

export type ResolveResult =
  | { ok: true; contents: string }
  | {
      ok: false;
      reason: 'empty_original' | 'empty_patch' | 'parse_error' | 'apply_error';
      message: string;
    };

/**
 * Resolve new contents from original + update payload.
 *
 * - `format: 'full'`: `contents` is the complete new text, returned as-is
 * - `format: 'diff'`: `contents` is a unified diff patch; applied to `original`
 *
 * Soft errors (empty original, empty patch, parse failure, apply failure) are
 * logged to console and returned as `{ ok: false, ... }` so the tool layer can
 * tell the LLM to re-read the current content and produce a valid diff.
 * `format=full` should only be suggested as a last resort.
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
  if (!original.trim()) {
    const msg =
      'Cannot apply a diff to empty content. Use format=full for the initial content, then format=diff for subsequent updates.';
    systemLogger.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'empty_original', message: msg };
  }

  if (!contents.trim()) {
    const msg =
      'The diff patch was empty. Read the current content first, then produce a unified diff patch with the changes you want to make.';
    systemLogger.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'empty_patch', message: msg };
  }

  let patches;
  try {
    patches = parsePatch(contents);
  } catch (e) {
    const msg = `The diff patch could not be parsed: ${
      e instanceof Error ? e.message : String(e)
    }. Re-read the current content and produce a valid unified diff patch (with --- / +++ headers and @@ hunk headers). Only use format=full as a last resort if you cannot produce a valid diff.`;
    systemLogger.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'parse_error', message: msg };
  }

  if (patches.length === 0) {
    const msg =
      'The diff patch was empty. Read the current content first, then produce a unified diff patch with the changes you want to make.';
    systemLogger.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'empty_patch', message: msg };
  }

  const hasAnyHunks = patches.some(p => p.hunks && p.hunks.length > 0);
  if (!hasAnyHunks) {
    const msg =
      'The diff patch contained no changes. Read the current content first, then produce a unified diff patch with the actual changes you want to make.';
    systemLogger.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'empty_patch', message: msg };
  }

  let result = original;
  try {
    for (const patch of patches) {
      const nextResult = applyPatch(result, patch);
      if (nextResult === false) {
        const msg =
          'The diff patch could not be applied to the current content. Re-read the current content to get the exact text, then produce a valid unified diff patch that matches it. Only use format=full as a last resort.';
        systemLogger.warn('[diff-resolver]', msg);
        return { ok: false, reason: 'apply_error', message: msg };
      }
      result = nextResult;
    }
  } catch (e) {
    const msg = `The diff patch could not be applied to the current content: ${e instanceof Error ? e.message : String(e)}. Re-read the current content to get the exact text, then produce a valid unified diff patch that matches it. Only use format=full as a last resort.`;
    systemLogger.warn('[diff-resolver]', msg);
    return { ok: false, reason: 'apply_error', message: msg };
  }

  return { ok: true, contents: result };
}
