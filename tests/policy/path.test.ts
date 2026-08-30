import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveWithinWorkspace } from '../../src/policy/path.js';

let root: string;
let outside: string;

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'law-path-'));
  root = join(base, 'workspace');
  outside = join(base, 'outside');
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'sub', 'a.txt'), 'hi');
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  // a symlink inside the workspace pointing outside it
  symlinkSync(outside, join(root, 'escape-link'));
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('RULE-001 path containment (REQ-013, EX-003)', () => {
  it('allows a descendant path', () => {
    expect(resolveWithinWorkspace(root, 'sub/a.txt').ok).toBe(true);
  });

  it('allows a not-yet-existing descendant (nonexistent parent stays inside)', () => {
    expect(resolveWithinWorkspace(root, 'newdir/newfile.txt').ok).toBe(true);
  });

  it('denies an absolute path outside the workspace', () => {
    const d = resolveWithinWorkspace(root, join(outside, 'secret.txt'));
    expect(d.ok).toBe(false);
    expect(d.code).toBe('OUTSIDE_ROOT');
  });

  it('denies a parent-traversal escape', () => {
    const d = resolveWithinWorkspace(root, '../outside/secret.txt');
    expect(d.ok).toBe(false);
  });

  it('denies a symlink escape', () => {
    const d = resolveWithinWorkspace(root, 'escape-link/secret.txt');
    expect(d.ok).toBe(false);
    expect(d.code).toBe('SYMLINK_ESCAPE');
  });

  it('denies a nonexistent-parent escape via symlinked ancestor', () => {
    const d = resolveWithinWorkspace(root, 'escape-link/does/not/exist.txt');
    expect(d.ok).toBe(false);
  });
});
