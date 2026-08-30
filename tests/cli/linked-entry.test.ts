import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('npm-linked CLI entry', () => {
  it('executes when argv points at a symlink to the built entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'law-linked-'));
    const link = join(root, 'law');
    symlinkSync(resolve('dist/cli/index.js'), link);
    const run = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('LAW for Pi');
    expect(run.stdout).toContain('law doctor');
  });
});
