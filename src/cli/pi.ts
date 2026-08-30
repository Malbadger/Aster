import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './operator.js';
import { createPiAdapter } from '../pi-adapter/index.js';
import { Graph } from '../graph/graph.js';
import { runGraph } from '../graph/runtime.js';
import { END } from '../graph/types.js';
import {
  createUpgradeCandidate,
  listUpgradeCandidates,
  prepareUpgradeWorktree,
  inspectUpgradeWorktree,
  qualifyUpgradeWorktree,
  promotionDecision,
  promoteUpgrade,
  qualifyUpgrade,
  recordUpgradeChanges,
  rollbackUpgrade,
  writeReleaseManifest,
  makeUpgradeAgentNode,
  captureUpgradeWorktreeChanges,
} from '../upgrade/index.js';
import type { CliIO } from './index.js';

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function runPiCommand(args: string[], io: CliIO): Promise<number> {
  const [sub, value] = args;
  const base = join(process.cwd(), 'work', 'upgrades');
  if (sub === 'status') {
    const config = loadConfig();
    const candidates = listUpgradeCandidates(base);
    io.out(
      `stable=${config.stablePi} tested=${config.testedPi ?? 'none'} candidates=${candidates.length} policy=qualified-only`,
    );
    return 0;
  }
  if (sub === 'review') {
    const candidate = listUpgradeCandidates(base).find((c) => c.upgradeId === value);
    if (!candidate) {
      io.err(`candidate not found: ${value ?? ''}`);
      return 4;
    }
    io.out(
      JSON.stringify(
        {
          upgradeId: candidate.upgradeId,
          status: candidate.status,
          fromPi: candidate.fromPi,
          toPi: candidate.toPi,
          integrity: candidate.integrity,
          changedPaths: candidate.changedPaths,
          passes: candidate.passes,
          independentAudit: candidate.independentAudit,
          rollback: 'stable.previous + qualified hash manifest required',
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (sub === 'repair') {
    const candidate = listUpgradeCandidates(base).find((c) => c.upgradeId === value);
    const profileId = opt(args, '--provider');
    const model = opt(args, '--model');
    if (!candidate || !profileId || !model) {
      io.err('usage: law pi repair <upgrade-id> --provider <profile> --model <model>');
      return 2;
    }
    const profile = loadConfig().providerPolicies.find((p) => p.id === profileId);
    if (!profile) {
      io.err(`unknown provider profile: ${profileId}`);
      return 4;
    }
    if (profile.provider !== 'ollama' && opt(args, '--allow') !== 'remote-provider') {
      io.err(
        'repair blocked: remote provider requires explicit --allow remote-provider; DATA LEAVES THIS MACHINE',
      );
      return 4;
    }
    const worktree = join(candidate.root, 'worktree');
    const adapter = createPiAdapter();
    const resolution = adapter.resolveProvider(profile, model);
    if (!resolution.ok) {
      io.err(`repair blocked: ${resolution.reason}`);
      return 4;
    }
    const node = makeUpgradeAgentNode({ adapter, profile, model, candidateRoot: worktree });
    const graph = new Graph({ version: 'upgrade-repair-v1', entry: node.name, inputs: ['diagnosis'] });
    graph.addNode(node).addEdge(node.name, END);
    const caps = await adapter.capabilities();
    const state = await runGraph(
      graph,
      { diagnosis: JSON.stringify(candidate.inspection ?? {}) },
      {
        hashes: {
          workflowHash: graph.topologyHash(),
          configHash: 'upgrade-isolated',
          adapterVersion: adapter.adapterVersion,
          piVersion: caps.pi.version ?? 'missing',
        },
      },
    );
    const captured = captureUpgradeWorktreeChanges(candidate, worktree);
    io.out(
      `REPAIR ${state.status.toUpperCase()} candidate=${captured.upgradeId} status=${captured.status} changed=${captured.changedPaths.join(',') || 'none'}`,
    );
    return state.status === 'completed' && captured.status !== 'blocked' ? 0 : 4;
  }
  if (sub === 'check-update') {
    if (!args.includes('--allow') || opt(args, '--allow') !== 'registry') {
      io.err('update check blocked: registry scope is not authorized; retry with --allow registry');
      return 4;
    }
    const query = spawnSync('npm', ['view', '@earendil-works/pi-coding-agent', 'version', '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (query.status !== 0) {
      io.err(`update check failed: ${query.stderr.trim()}`);
      return 4;
    }
    io.out(`latest=${String(query.stdout).trim()} stable=${loadConfig().stablePi} production_unchanged=true`);
    return 0;
  }
  if (sub === 'qualify') {
    const target = value ?? 'compatible-patch';
    let candidate = createUpgradeCandidate(base, loadConfig().stablePi, target);
    if (!args.includes('--fixture')) {
      if (opt(args, '--allow') !== 'registry') {
        io.err('qualification blocked: candidate installation needs explicit --allow registry');
        return 4;
      }
      const auditReport = opt(args, '--audit-report');
      if (!auditReport) {
        io.err('qualification blocked: --audit-report <path> is required');
        return 4;
      }
      const prepared = prepareUpgradeWorktree(candidate, process.cwd());
      if (!prepared.ok) {
        io.err(prepared.reason);
        return 4;
      }
      candidate = inspectUpgradeWorktree(candidate, prepared.worktree);
      candidate = qualifyUpgradeWorktree(candidate, prepared.worktree, auditReport);
      io.out(
        candidate.status === 'qualified'
          ? `QUALIFIED NOT PROMOTED id=${candidate.upgradeId}`
          : `CANDIDATE BLOCKED id=${candidate.upgradeId}`,
      );
      return candidate.status === 'qualified' ? 0 : 4;
    }
    if (target.includes('malicious')) candidate = recordUpgradeChanges(candidate, ['src/policy/provider.ts']);
    else {
      if (target.includes('breaking'))
        candidate = recordUpgradeChanges(candidate, ['src/pi-adapter/events.ts']);
      candidate = qualifyUpgrade(candidate, {
        immutableSuite: true,
        passes: 2,
        independentAudit: 'pass',
        integrityOk: true,
      });
    }
    io.out(
      candidate.status === 'qualified'
        ? `QUALIFIED NOT PROMOTED id=${candidate.upgradeId}`
        : `CANDIDATE BLOCKED id=${candidate.upgradeId}`,
    );
    return candidate.status === 'qualified' ? 0 : 4;
  }
  if (sub === 'promote') {
    const candidate = listUpgradeCandidates(base).find((c) => c.upgradeId === value);
    if (!candidate) {
      io.err(`promotion refused: candidate not found: ${value ?? ''}`);
      return 4;
    }
    const confirmation = opt(args, '--confirm');
    const decision = promotionDecision(candidate, confirmation);
    if (!decision.ok) {
      io.err(`promotion refused: ${decision.reason}`);
      return 4;
    }
    const promoted = promoteUpgrade(candidate, join(process.cwd(), 'work', 'dist', 'stable'), confirmation);
    io.out(`PROMOTED ${promoted.upgradeId}`);
    return promoted.status === 'promoted' ? 0 : 4;
  }
  if (sub === 'rollback') {
    if (value === '--fixture') {
      const root = mkdtempSync(join(tmpdir(), 'law-rollback-'));
      const stable = join(root, 'stable');
      mkdirSync(stable);
      writeFileSync(join(stable, 'current'), 'current');
      mkdirSync(`${stable}.previous`);
      writeFileSync(join(`${stable}.previous`, 'prior'), 'prior');
      writeReleaseManifest(`${stable}.previous`, ['prior']);
      const ok = rollbackUpgrade(stable);
      io.out(ok ? 'ROLLBACK PASS verified-qualified-manifest=true' : 'ROLLBACK FAIL');
      return ok ? 0 : 4;
    }
    const ok = rollbackUpgrade(join(process.cwd(), 'work', 'dist', 'stable'));
    io.out(ok ? 'ROLLBACK PASS' : 'rollback unavailable: no prior qualified release');
    return ok ? 0 : 4;
  }
  io.err(`law pi: unknown command "${sub ?? ''}"`);
  return 2;
}
