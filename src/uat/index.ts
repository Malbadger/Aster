import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function privateBenchmarksUnavailable(): string | null {
  return existsSync(join(process.cwd(), 'benchmarks', 'cases.json'))
    ? null
    : 'private exemplar corpus is intentionally not distributed with the source repository';
}

function liveContainerUnavailable(): string | null {
  for (const engine of ['docker', 'podman']) {
    const info = spawnSync(engine, ['info'], { encoding: 'utf8', timeout: 10_000 });
    if (info.status !== 0) continue;
    const image = spawnSync(engine, ['image', 'inspect', 'node:22-alpine'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (image.status === 0) return null;
  }
  return 'no usable Docker/Podman engine with the preinstalled controlled node:22-alpine image; no image pull authorized';
}

export interface UatRow {
  id: string;
  result: 'PASS' | 'FAIL' | 'NOT-RUN(human-only)' | 'NOT-RUN(environment)';
  detail: string;
  command?: string;
  exitCode?: number;
}

interface Case {
  id: string;
  command: string[];
  environment?: () => string | null;
  humanOnly?: string;
}
const test = (...files: string[]): string[] => ['npx', 'vitest', 'run', ...files, '--reporter=dot'];
const CASES: Case[] = [
  {
    id: 'UAT-001',
    command: [
      'bash',
      '-lc',
      'before="$(command -v pi 2>/dev/null || true)|$(pi --version 2>/dev/null || true)"; npm ci --ignore-scripts >/dev/null && npm run build >/dev/null && node dist/cli/index.js --help >/dev/null; after="$(command -v pi 2>/dev/null || true)|$(pi --version 2>/dev/null || true)"; test "$before" = "$after"',
    ],
  },
  { id: 'UAT-002', command: test('tests/static/imports.test.ts', 'tests/adapter/contract.test.ts') },
  { id: 'UAT-003', command: test('tests/doctor.test.ts') },
  { id: 'UAT-004', command: test('tests/cli/operator.test.ts', 'tests/provider/claude-max-denial.test.ts') },
  { id: 'UAT-005', command: test('tests/cli/operator.test.ts', 'tests/evidence/export.test.ts') },
  { id: 'UAT-006', command: test('tests/provider/claude-max-denial.test.ts') },
  {
    id: 'UAT-007',
    command: test('tests/provider/claude-max-denial.test.ts', 'tests/graph/session-node.test.ts'),
  },
  { id: 'UAT-008', command: test('tests/policy/network-authz.test.ts') },
  { id: 'UAT-009', command: test('tests/policy/network-authz.test.ts') },
  { id: 'UAT-010', command: test('tests/policy/run-mode.test.ts') },
  { id: 'UAT-011', command: test('tests/policy/run-mode.test.ts', 'tests/policy/interceptor.test.ts') },
  { id: 'UAT-012', command: test('tests/policy/path.test.ts', 'tests/policy/interceptor.test.ts') },
  {
    id: 'UAT-013',
    environment: liveContainerUnavailable,
    command: ['node', 'scripts/container-uat.mjs'],
  },
  { id: 'UAT-014', command: test('tests/graph/validate.test.ts') },
  { id: 'UAT-015', command: test('tests/graph/session-node.test.ts', 'tests/graph/runtime.test.ts') },
  { id: 'UAT-016', command: test('tests/graph/session-node.test.ts') },
  { id: 'UAT-017', command: test('tests/graph/runtime.test.ts') },
  { id: 'UAT-018', command: test('tests/graph/runtime.test.ts', 'tests/cli/operator.test.ts') },
  { id: 'UAT-019', command: test('tests/graph/runtime.test.ts') },
  { id: 'UAT-020', command: test('tests/graph/runtime.test.ts', 'tests/graph/session-node.test.ts') },
  { id: 'UAT-021', command: test('tests/graph/verify.test.ts') },
  {
    id: 'UAT-022',
    environment: privateBenchmarksUnavailable,
    command: [
      'bash',
      '-lc',
      'node dist/cli/index.js benchmark --provider scripted | grep -q "BENCHMARK PASS"',
    ],
  },
  { id: 'UAT-023', command: test('tests/evidence/export.test.ts') },
  { id: 'UAT-024', environment: privateBenchmarksUnavailable, command: test('tests/benchmark/exemplars.test.ts', 'tests/adapter/contract.test.ts') },
  { id: 'UAT-025', command: test('tests/upgrade/upgrade.test.ts') },
  { id: 'UAT-026', command: test('tests/upgrade/upgrade.test.ts') },
  { id: 'UAT-027', command: test('tests/upgrade/upgrade.test.ts') },
  { id: 'UAT-028', command: test('tests/upgrade/upgrade.test.ts') },
  { id: 'UAT-029', command: test('tests/upgrade/upgrade.test.ts') },
  { id: 'UAT-030', command: test('tests/upgrade/upgrade.test.ts') },
  {
    id: 'UAT-031',
    command: [],
    humanOnly: 'requires an owner-authenticated live Pi provider to observe SDK interception',
  },
];

export function runUatBattery(options: { cleanInstall?: boolean } = {}): UatRow[] {
  return CASES.map((c) => {
    const unavailable = c.environment?.();
    if (unavailable) return { id: c.id, result: 'NOT-RUN(environment)', detail: unavailable };
    if (c.humanOnly) return { id: c.id, result: 'NOT-RUN(human-only)', detail: c.humanOnly };
    const command =
      c.id === 'UAT-001' && !options.cleanInstall
        ? ['bash', '-lc', 'npm run build >/dev/null && node dist/cli/index.js --help >/dev/null']
        : c.command;
    const [program, ...args] = command;
    const run = spawnSync(program as string, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120_000,
    });
    const exitCode = run.status ?? 1;
    const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim();
    return {
      id: c.id,
      result: exitCode === 0 ? 'PASS' : 'FAIL',
      detail: exitCode === 0 ? 'command-backed acceptance observation passed' : output.slice(-600),
      command: command.join(' '),
      exitCode,
    };
  });
}

export function renderUat(rows: UatRow[], passNumber: number): string {
  const passed = rows.filter((r) => r.result === 'PASS').length;
  const failed = rows.filter((r) => r.result === 'FAIL').length;
  const lines = rows.map(
    (r) => `${r.result} ${r.id} ${r.detail}${r.command ? ` command=${r.command} exit=${r.exitCode}` : ''}`,
  );
  lines.push(
    `${failed === 0 ? 'UAT PASS' : 'UAT FAIL'} pass=${passNumber} rows=${rows.length} passed=${passed} notRun=${rows.length - passed - failed}`,
  );
  return lines.join('\n');
}
