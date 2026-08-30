import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('REQ-002/003 public Pi boundary', () => {
  it('import-guard passes: no internal Pi imports, no terminal-parse-as-API, Pi only inside pi-adapter', () => {
    const out = execFileSync('node', ['scripts/check-imports.mjs'], { cwd: root, encoding: 'utf8' });
    expect(out).toContain('IMPORT-GUARD PASS');
  });
});
