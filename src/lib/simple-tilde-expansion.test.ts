import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { simpleExpandTilde } from './simple-tilde-expansion.js';

describe('simpleExpandTilde', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    process.env.HOME = '/home/testuser';
    delete process.env.USERPROFILE;
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalUserProfile !== undefined) {
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  it('expands ~/path using HOME', () => {
    expect(simpleExpandTilde('~/documents/file.txt')).toBe(
      path.join('/home/testuser', 'documents/file.txt')
    );
  });

  it('falls back to USERPROFILE when HOME is unset', () => {
    delete process.env.HOME;
    process.env.USERPROFILE = '/home/winuser';
    expect(simpleExpandTilde('~/documents/file.txt')).toBe(
      path.join('/home/winuser', 'documents/file.txt')
    );
  });

  it('does not expand absolute paths', () => {
    expect(simpleExpandTilde('/absolute/path')).toBe('/absolute/path');
  });

  it('does not expand relative paths without a tilde', () => {
    expect(simpleExpandTilde('relative/path')).toBe('relative/path');
  });

  it('does not expand ~username paths (unsupported convention)', () => {
    expect(simpleExpandTilde('~username/path')).toBe('~username/path');
  });

  it('does not expand a bare ~ with no slash', () => {
    expect(simpleExpandTilde('~')).toBe('~');
  });

  it('returns an empty string unchanged', () => {
    expect(simpleExpandTilde('')).toBe('');
  });
});
