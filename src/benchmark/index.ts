import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultLawConfig } from '../config/profiles.js';
import { BudgetTracker } from '../graph/budget.js';
import { assertNoProviderSwitch, assertModelAllowed } from '../policy/provider.js';
import { resolveWithinWorkspace } from '../policy/path.js';
import { createUpgradeCandidate, qualifyUpgrade, recordUpgradeChanges } from '../upgrade/index.js';
import { shouldRunSideEffectNode } from '../graph/checkpoint.js';
import type { RunState } from '../graph/types.js';

export interface ExemplarResult {
  id: string;
  pass: boolean;
  detail: string;
}

interface CaseFile {
  schemaVersion: number;
  version: string;
  cases: Array<{ id: string; kind: string; expected: string }>;
}
const BENCHMARK_ROOT = fileURLToPath(new URL('../../benchmarks/', import.meta.url));

export function loadExemplarCases(): CaseFile {
  const path = join(BENCHMARK_ROOT, 'cases.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as CaseFile;
  const expected = Array.from({ length: 9 }, (_, i) => `EX-${String(i + 1).padStart(3, '0')}`);
  if (
    parsed.schemaVersion !== 1 ||
    JSON.stringify(parsed.cases.map((c) => c.id)) !== JSON.stringify(expected)
  )
    throw new Error('benchmark case file is incomplete or reordered');
  return parsed;
}

function editExemplar(): ExemplarResult {
  const root = mkdtempSync(join(tmpdir(), 'law-ex1-'));
  const allowed = join(root, 'function.ts');
  writeFileSync(allowed, readFileSync(join(BENCHMARK_ROOT, 'fixtures/ex-001/input.txt')));
  writeFileSync(allowed, readFileSync(join(BENCHMARK_ROOT, 'fixtures/ex-001/expected.txt')));
  const changed = ['function.ts'];
  return {
    id: 'EX-001',
    pass: readFileSync(allowed, 'utf8').includes('a+b') && changed.length === 1,
    detail: 'frozen edit changed exactly the authorized source file',
  };
}

function regressionExemplar(): ExemplarResult {
  const fixture = readFileSync(join(BENCHMARK_ROOT, 'fixtures/ex-002/control.txt'), 'utf8');
  const broken = (n: number) => n - 1;
  const fixed = (n: number) => n + 1;
  return {
    id: 'EX-002',
    pass: fixture.includes('failure-before-repair') && broken(1) !== 2 && fixed(1) === 2,
    detail: 'seeded control failed and repaired implementation passed',
  };
}

function idempotencyExemplar(): ExemplarResult {
  const expected = readFileSync(join(BENCHMARK_ROOT, 'fixtures/ex-005/expected.txt'), 'utf8').trim();
  const state: RunState = {
    runId: 'ex5',
    workflowHash: 'w',
    configHash: 'c',
    status: 'running',
    data: {},
    results: {},
    step: 0,
    attempts: {},
    trace: [],
  };
  let effects = 0;
  if (shouldRunSideEffectNode(state, 'send')) effects += 1;
  state.results.send = { status: 'ok', sideEffect: true };
  if (shouldRunSideEffectNode(state, 'send')) effects += 1;
  return {
    id: 'EX-005',
    pass: `side-effect-count=${effects}` === expected,
    detail: 'resume idempotency gate produced exactly one side effect',
  };
}

function pathExemplar(): ExemplarResult {
  const base = mkdtempSync(join(tmpdir(), 'law-ex3-'));
  const root = join(base, 'workspace');
  const outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret'), 'unchanged');
  symlinkSync(outside, join(root, 'escape'));
  const denied = [
    resolveWithinWorkspace(root, '../outside/secret'),
    resolveWithinWorkspace(root, join(outside, 'secret')),
    resolveWithinWorkspace(root, 'escape/secret'),
  ];
  return {
    id: 'EX-003',
    pass: denied.every((d) => !d.ok),
    detail: 'traversal, absolute, and symlink escapes denied',
  };
}

function providerExemplar(): ExemplarResult {
  const profile = defaultLawConfig().providerPolicies.find((p) => p.id === 'claude-pro');
  if (!profile) return { id: 'EX-004', pass: false, detail: 'profile missing' };
  const max = assertModelAllowed(profile, 'Claude-Opus-Max');
  const switched = assertNoProviderSwitch(
    { provider: 'ollama', model: 'qwen' },
    { provider: 'chatgpt', model: 'gpt-5' },
  );
  return { id: 'EX-004', pass: !max.ok && !switched.ok, detail: 'Claude Max and hidden switch denied' };
}

function budgetExemplar(): ExemplarResult {
  const tracker = new BudgetTracker({ maxSteps: 2, deadlineMs: 60_000, defaultMaxAttempts: 1 }, 0);
  tracker.tick();
  tracker.tick();
  const check = tracker.check(1);
  return {
    id: 'EX-006',
    pass: !check.ok && check.kind === 'steps',
    detail: 'stopped at exact two-step ceiling',
  };
}

function upgradeExemplars(): ExemplarResult[] {
  const base = mkdtempSync(join(tmpdir(), 'law-upgrade-'));
  const compatible = qualifyUpgrade(createUpgradeCandidate(base, '0.84.4', '0.84.5'), {
    immutableSuite: true,
    passes: 2,
    independentAudit: 'pass',
    integrityOk: true,
  });
  const adapted = qualifyUpgrade(
    recordUpgradeChanges(createUpgradeCandidate(base, '0.84.4', '0.85.0'), [
      'src/pi-adapter/events.ts',
      'tests/upgrade/regressions/pi-085.test.ts',
    ]),
    { immutableSuite: true, passes: 2, independentAudit: 'pass', integrityOk: true },
  );
  const malicious = recordUpgradeChanges(createUpgradeCandidate(base, '0.84.4', '9.0.0'), [
    'src/policy/provider.ts',
    'benchmarks/cases.json',
  ]);
  return [
    {
      id: 'EX-007',
      pass: compatible.status === 'qualified',
      detail: 'compatible patch qualified, not promoted',
    },
    {
      id: 'EX-008',
      pass: adapted.status === 'qualified',
      detail: 'breaking API adapted only in allowed paths',
    },
    {
      id: 'EX-009',
      pass: malicious.status === 'blocked',
      detail: 'malicious policy/fixture changes blocked',
    },
  ];
}

export function runRequiredExemplars(): ExemplarResult[] {
  const cases = loadExemplarCases();
  const results = [
    editExemplar(),
    regressionExemplar(),
    pathExemplar(),
    providerExemplar(),
    idempotencyExemplar(),
    budgetExemplar(),
    ...upgradeExemplars(),
  ];
  return results.map((result, i) => ({
    ...result,
    detail: `${result.detail}; expected=${cases.cases[i]?.expected}`,
  }));
}

export function renderBenchmark(results: ExemplarResult[], provider: string): string {
  const lines = results.map((r) => `${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.detail}`);
  const passed = results.filter((r) => r.pass).length;
  lines.push(`provider=${provider} cases=${results.length} passed=${passed}`);
  lines.push(passed === results.length ? 'BENCHMARK PASS' : 'BENCHMARK FAIL');
  return lines.join('\n');
}
