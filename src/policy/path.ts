/**
 * RULE-001 path containment (BN-005, REQ-013, EX-003).
 *
 * A resolved target must equal the workspace root or be a descendant of it. Symlink
 * escapes and nonexistent-target-parent escapes are both checked by resolving the real
 * path of the nearest existing ancestor before reconstructing the full target.
 */

import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

export interface PathDecision {
  ok: boolean;
  reason: string;
  resolved?: string;
  code?: 'OUTSIDE_ROOT' | 'SYMLINK_ESCAPE' | 'ROOT_MISSING';
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * Resolve `target` (absolute or relative to the workspace root) and confirm it stays
 * within the workspace, accounting for symlinks and not-yet-existing paths.
 */
export function resolveWithinWorkspace(workspaceRoot: string, target: string): PathDecision {
  let rootReal: string;
  try {
    rootReal = realpathSync(workspaceRoot);
  } catch {
    return { ok: false, code: 'ROOT_MISSING', reason: `Workspace root "${workspaceRoot}" does not exist.` };
  }

  const abs = isAbsolute(target) ? resolve(target) : resolve(rootReal, target);

  // Lexical containment first: an absolute path or `..` traversal that leaves the root
  // is a plain OUTSIDE_ROOT escape, distinct from a symlink escape.
  if (!within(rootReal, abs)) {
    return {
      ok: false,
      code: 'OUTSIDE_ROOT',
      reason: `Target "${target}" resolves to "${abs}", outside workspace "${rootReal}".`,
    };
  }

  // Walk up to the nearest existing ancestor and resolve its real path (defeats symlinks).
  let existing = abs;
  while (!existsSync(existing) && dirname(existing) !== existing) {
    existing = dirname(existing);
  }
  let existingReal: string;
  try {
    existingReal = realpathSync(existing);
  } catch {
    return { ok: false, code: 'OUTSIDE_ROOT', reason: `Cannot resolve real path of "${existing}".` };
  }

  // The real, existing portion must already be within the root.
  if (!within(rootReal, existingReal)) {
    return {
      ok: false,
      code: 'SYMLINK_ESCAPE',
      reason: `Target "${target}" resolves (via existing ancestor "${existing}") to "${existingReal}", outside workspace "${rootReal}".`,
    };
  }

  // Reconstruct the full resolved path: real existing prefix + not-yet-existing remainder.
  const remainder = abs.slice(existing.length);
  const resolved = remainder ? existingReal + remainder : existingReal;

  if (!within(rootReal, resolved)) {
    return {
      ok: false,
      code: 'OUTSIDE_ROOT',
      reason: `Target "${target}" resolves to "${resolved}", outside workspace "${rootReal}".`,
    };
  }
  return { ok: true, resolved, reason: `Target "${target}" is within workspace.` };
}
