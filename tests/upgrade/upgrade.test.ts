import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertCandidateContained,
  createUpgradeCandidate,
  promotionDecision,
  qualifyUpgrade,
  recordUpgradeChanges,
  rollbackUpgrade,
  writeReleaseManifest,
  makeUpgradeAgentNode,
  inspectUpgradeWorktree,
  qualifyUpgradeWorktree,
  upgradePathDecision,
} from '../../src/upgrade/index.js';
import { ScriptedPiAdapter, defaultScriptedCapabilities } from '../../src/pi-adapter/index.js';
import { defaultLawConfig } from '../../src/config/profiles.js';
describe('upgrade lab', () => {
  it('allows adapter paths', () => expect(upgradePathDecision('src/pi-adapter/x.ts').ok).toBe(true));
  it('blocks policy paths', () => expect(upgradePathDecision('src/policy/provider.ts').ok).toBe(false));
  it('blocks expected-result edits', () =>
    expect(upgradePathDecision('benchmarks/cases.json').ok).toBe(false));
  it('contains candidate targets', () =>
    expect(assertCandidateContained('/tmp/candidate', '/tmp/candidate/src/a')).toBe(true));
  it('rejects outside targets', () =>
    expect(assertCandidateContained('/tmp/candidate', '/tmp/other')).toBe(false));
  it('qualifies only after immutable two-pass independent audit', () => {
    const c = createUpgradeCandidate(mkdtempSync(join(tmpdir(), 'law-u-')), '1', '2');
    expect(
      qualifyUpgrade(c, { immutableSuite: true, passes: 2, independentAudit: 'pass', integrityOk: true })
        .status,
    ).toBe('qualified');
    expect(
      qualifyUpgrade(c, { immutableSuite: true, passes: 1, independentAudit: 'pass', integrityOk: true })
        .status,
    ).toBe('blocked');
  });
  it('blocks forbidden changes', () => {
    const c = createUpgradeCandidate(mkdtempSync(join(tmpdir(), 'law-u-')), '1', '2');
    expect(recordUpgradeChanges(c, ['src/policy/x.ts']).status).toBe('blocked');
  });
  it('requires exact owner confirmation', () => {
    const c = qualifyUpgrade(createUpgradeCandidate(mkdtempSync(join(tmpdir(), 'law-u-')), '1', '2'), {
      immutableSuite: true,
      passes: 2,
      independentAudit: 'pass',
      integrityOk: true,
    });
    mkdirSync(join(c.root, 'worktree'));
    writeFileSync(join(c.root, 'worktree', 'candidate.txt'), 'qualified');
    writeReleaseManifest(join(c.root, 'worktree'), ['candidate.txt']);
    expect(promotionDecision(c).ok).toBe(false);
    expect(promotionDecision(c, `PROMOTE ${c.upgradeId}`).ok).toBe(true);
  });
  it('rolls back prior stable', () => {
    const base = mkdtempSync(join(tmpdir(), 'law-r-'));
    const stable = join(base, 'stable');
    mkdirSync(stable);
    writeFileSync(join(stable, 'new'), 'new');
    mkdirSync(`${stable}.previous`);
    writeFileSync(join(`${stable}.previous`, 'old'), 'old');
    writeReleaseManifest(`${stable}.previous`, ['old']);
    expect(rollbackUpgrade(stable)).toBe(true);
  });
  it('refuses rollback when a qualified release hash is stale', () => {
    const base = mkdtempSync(join(tmpdir(), 'law-r-'));
    const stable = join(base, 'stable');
    mkdirSync(stable);
    mkdirSync(`${stable}.previous`);
    writeFileSync(join(`${stable}.previous`, 'old'), 'old');
    writeReleaseManifest(`${stable}.previous`, ['old']);
    writeFileSync(join(`${stable}.previous`, 'old'), 'tampered');
    expect(rollbackUpgrade(stable)).toBe(false);
  });
  it('bounded upgrade agent blocks policy writes before the adapter executes them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'law-agent-'));
    mkdirSync(join(root, 'src', 'policy'), { recursive: true });
    const adapter = new ScriptedPiAdapter({
      capabilities: defaultScriptedCapabilities(),
      plan: () => ({
        steps: [{ t: 'tool', tool: 'write', input: { path: 'src/policy/provider.ts' }, okSummary: 'bad' }],
      }),
    });
    const profile = defaultLawConfig().providerPolicies[0];
    const node = makeUpgradeAgentNode({ adapter, profile: profile!, model: 'qwen', candidateRoot: root });
    const result = await node.run({
      state: {} as never,
      reads: { diagnosis: 'breaking event rename' },
      runId: 'u',
      node: node.name,
      attempt: 1,
    });
    expect(result.toolCalls?.[0]).toMatchObject({ denied: true, ok: false });
  });
  it('derives a real worktree diff and qualifies only with two commands passes and an external audit', () => {
    const base = mkdtempSync(join(tmpdir(), 'law-real-u-'));
    const candidate = createUpgradeCandidate(base, '0.84.4', '0.84.5');
    const worktree = join(candidate.root, 'worktree');
    mkdirSync(join(worktree, 'src', 'pi-adapter'), { recursive: true });
    mkdirSync(join(worktree, 'node_modules', '@earendil-works', 'pi-coding-agent'), { recursive: true });
    mkdirSync(join(worktree, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist'), {
      recursive: true,
    });
    writeFileSync(
      join(worktree, 'package.json'),
      JSON.stringify({ scripts: { build: 'true', check: 'true', test: 'true' } }),
    );
    writeFileSync(
      join(worktree, 'package-lock.json'),
      JSON.stringify({
        packages: { 'node_modules/@earendil-works/pi-coding-agent': { integrity: 'sha512-controlled' } },
      }),
    );
    writeFileSync(
      join(worktree, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'),
      JSON.stringify({ version: '0.84.5', types: 'dist/index.d.ts', exports: { '.': './dist/index.js' } }),
    );
    writeFileSync(
      join(worktree, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
      'exports.testCapability = true;\n',
    );
    writeFileSync(join(worktree, 'src', 'pi-adapter', 'events.ts'), 'before');
    for (const args of [
      ['init'],
      ['config', 'user.email', 'test@example.invalid'],
      ['config', 'user.name', 'Test'],
      ['add', '.'],
      ['commit', '-m', 'baseline'],
    ]) {
      expect(spawnSync('git', args, { cwd: worktree }).status).toBe(0);
    }
    writeFileSync(join(worktree, 'src', 'pi-adapter', 'events.ts'), 'after');
    const inspected = inspectUpgradeWorktree(candidate, worktree);
    const report = join(candidate.root, 'audit.txt');
    writeFileSync(report, 'Verdict: ACCEPT\n');
    const qualified = qualifyUpgradeWorktree(inspected, worktree, report);
    expect(qualified.status).toBe('qualified');
    expect(qualified.changedPaths).toEqual(['src/pi-adapter/events.ts']);
    expect(qualified.passes).toBe(2);
  });
});
