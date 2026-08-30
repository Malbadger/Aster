import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertEvidenceContainsNoSecrets, redact, writeEvidenceBundle } from '../../src/evidence/index.js';
describe('evidence', () => {
  it('redacts credential keys and values', () =>
    expect(redact({ apiKey: 'sk-secret123456', text: 'Bearer abc.def.ghi' })).toEqual({
      apiKey: '[REDACTED]',
      text: '[REDACTED]',
    }));
  it('writes a secret-free provider-neutral bundle', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'law-ev-')), 'bundle.json');
    writeEvidenceBundle(path, {
      schemaVersion: 1,
      runId: 'r',
      createdAt: 'x',
      provider: { id: 'ollama', model: 'q', locality: 'local' },
      hashes: {},
      trace: [{ password: 'bad' }],
      checks: [],
      diff: '',
      limitations: [],
    });
    expect(assertEvidenceContainsNoSecrets(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).not.toContain('bad');
  });
});
