import { join } from 'node:path';
import { assertEvidenceContainsNoSecrets, writeEvidenceBundle } from '../evidence/index.js';
import type { CliIO } from './index.js';

export function runEvidenceCommand(args: string[], io: CliIO): number {
  if (args[0] !== 'export') {
    io.err('law evidence: expected export <run>');
    return 2;
  }
  const runId = args[1] ?? 'run-manual';
  const path = join(process.cwd(), 'work', 'evidence', 'exports', `${runId}.json`);
  const written = writeEvidenceBundle(path, {
    schemaVersion: 1,
    runId,
    createdAt: new Date(0).toISOString(),
    provider: { id: 'unselected', model: 'unselected', locality: 'unknown' },
    hashes: {},
    trace: [],
    checks: [],
    diff: '',
    limitations: ['No run data supplied to manual export.'],
  });
  if (!assertEvidenceContainsNoSecrets(path)) {
    io.err('evidence export blocked: secret scan failed');
    return 4;
  }
  io.out(`EVIDENCE PASS path=${written.path} sha256=${written.sha256}`);
  return 0;
}
