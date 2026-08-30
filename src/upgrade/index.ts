import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { probePiPublicExports, type PiAdapter } from '../pi-adapter/index.js';
import type { ProviderProfile } from '../types.js';
import { makePiSessionNode } from '../graph/pi-session-node.js';

export type UpgradeStatus =
  | 'available'
  | 'diagnosing'
  | 'adapted'
  | 'blocked'
  | 'qualified'
  | 'promoted'
  | 'rolled-back';

export interface UpgradeCandidate {
  upgradeId: string;
  fromPi: string;
  toPi: string;
  root: string;
  status: UpgradeStatus;
  integrity: string;
  changedPaths: string[];
  passes: number;
  independentAudit: 'pending' | 'pass' | 'fail';
  inspection?: {
    packageVersion: string;
    packageIntegrity: string;
    exports: string[];
    types: string | null;
    changelog: string | null;
    runtimeExports: string[];
    exportDelta: { added: string[]; removed: string[] };
    failures: string[];
  };
}

export const UPGRADE_ALLOWED = [
  'src/pi-adapter/',
  'src/upgrade/shims/',
  'src/upgrade/normalizers/',
  'tests/adapter/',
  'tests/upgrade/regressions/',
  'docs/pi-changes/',
];

export const UPGRADE_FORBIDDEN = [
  'docs/build-kit/',
  'benchmarks/cases.json',
  'src/policy/',
  'src/upgrade/index.ts',
  'node_modules/',
  '.pi/',
];

export function upgradePathDecision(path: string): { ok: boolean; reason: string } {
  const clean = normalize(path).replaceAll('\\', '/').replace(/^\.\//, '');
  if (clean.startsWith('../') || clean.startsWith('/')) return { ok: false, reason: 'outside candidate' };
  if (UPGRADE_FORBIDDEN.some((p) => clean.startsWith(p))) return { ok: false, reason: 'protected path' };
  if (!UPGRADE_ALLOWED.some((p) => clean.startsWith(p)))
    return { ok: false, reason: 'not in upgrade allowlist' };
  return { ok: true, reason: 'allowed candidate compatibility path' };
}

function digest(v: string | Buffer): string {
  return createHash('sha256').update(v).digest('hex');
}

export function createUpgradeCandidate(base: string, fromPi: string, toPi: string): UpgradeCandidate {
  const upgradeId = `pi-${fromPi}-to-${toPi}-${digest(`${fromPi}:${toPi}`).slice(0, 8)}`;
  const root = join(base, upgradeId);
  mkdirSync(root, { recursive: true });
  const candidate: UpgradeCandidate = {
    upgradeId,
    fromPi,
    toPi,
    root,
    status: 'diagnosing',
    integrity: digest(`@earendil-works/pi-coding-agent@${toPi}`),
    changedPaths: [],
    passes: 0,
    independentAudit: 'pending',
  };
  writeFileSync(join(root, 'candidate.json'), JSON.stringify(candidate, null, 2));
  return candidate;
}

export function recordUpgradeChanges(candidate: UpgradeCandidate, paths: string[]): UpgradeCandidate {
  const denied = paths.filter((p) => !upgradePathDecision(p).ok);
  return saveCandidate({
    ...candidate,
    changedPaths: [...paths],
    status: denied.length ? 'blocked' : 'adapted',
  });
}

export function qualifyUpgrade(
  candidate: UpgradeCandidate,
  input: { immutableSuite: boolean; passes: number; independentAudit: 'pass' | 'fail'; integrityOk: boolean },
): UpgradeCandidate {
  const scopeOk = candidate.changedPaths.every((p) => upgradePathDecision(p).ok);
  const qualified =
    scopeOk &&
    input.immutableSuite &&
    input.passes >= 2 &&
    input.independentAudit === 'pass' &&
    input.integrityOk;
  return saveCandidate({
    ...candidate,
    passes: input.passes,
    independentAudit: input.independentAudit,
    status: qualified ? 'qualified' : 'blocked',
  });
}

export function promotionDecision(
  candidate: UpgradeCandidate,
  confirmation?: string,
): { ok: boolean; reason: string } {
  if (candidate.status !== 'qualified') return { ok: false, reason: 'candidate is not qualified' };
  if (!verifyReleaseManifest(join(candidate.root, 'worktree')))
    return { ok: false, reason: 'qualified candidate manifest is missing or stale' };
  if (confirmation !== `PROMOTE ${candidate.upgradeId}`)
    return { ok: false, reason: 'owner confirmation missing or invalid' };
  return { ok: true, reason: 'owner confirmation and qualification present' };
}

export function promoteUpgrade(
  candidate: UpgradeCandidate,
  stableDir: string,
  confirmation?: string,
): UpgradeCandidate {
  const decision = promotionDecision(candidate, confirmation);
  if (!decision.ok) return { ...candidate, status: 'blocked' };
  mkdirSync(dirname(stableDir), { recursive: true });
  const staged = `${stableDir}.staged`;
  rmSync(staged, { recursive: true, force: true });
  cpSync(candidate.root, staged, { recursive: true });
  const files = listReleaseFiles(staged);
  writeReleaseManifest(staged, files);
  if (existsSync(stableDir)) {
    rmSync(`${stableDir}.previous`, { recursive: true, force: true });
    renameSync(stableDir, `${stableDir}.previous`);
  }
  renameSync(staged, stableDir);
  return { ...candidate, status: 'promoted' };
}

export function rollbackUpgrade(stableDir: string): boolean {
  const previous = `${stableDir}.previous`;
  if (!existsSync(previous)) return false;
  if (!verifyReleaseManifest(previous)) return false;
  rmSync(stableDir, { recursive: true, force: true });
  renameSync(previous, stableDir);
  return true;
}

export interface ReleaseManifest {
  schemaVersion: 1;
  qualified: true;
  files: Record<string, string>;
}

export function writeReleaseManifest(root: string, files: string[]): ReleaseManifest {
  const manifest: ReleaseManifest = { schemaVersion: 1, qualified: true, files: {} };
  for (const file of files) {
    const full = join(root, file);
    if (!existsSync(full)) throw new Error(`release file missing: ${file}`);
    manifest.files[file] = digest(readFileSync(full));
  }
  writeFileSync(join(root, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function verifyReleaseManifest(root: string): boolean {
  const path = join(root, 'release-manifest.json');
  if (!existsSync(path)) return false;
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as ReleaseManifest;
    if (manifest.schemaVersion !== 1 || manifest.qualified !== true) return false;
    return Object.entries(manifest.files).every(([file, expected]) => {
      const full = resolve(root, file);
      return (
        assertCandidateContained(root, full) && existsSync(full) && digest(readFileSync(full)) === expected
      );
    });
  } catch {
    return false;
  }
}

function listReleaseFiles(root: string, relativeDir = ''): string[] {
  const dir = join(root, relativeDir);
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = join(relativeDir, entry.name).replaceAll('\\', '/');
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'release-manifest.json')
      continue;
    if (entry.isDirectory()) out.push(...listReleaseFiles(root, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

export function assertCandidateContained(candidateRoot: string, target: string): boolean {
  const rel = relative(resolve(candidateRoot), resolve(target));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
}

export function readCandidate(path: string): UpgradeCandidate {
  return JSON.parse(readFileSync(path, 'utf8')) as UpgradeCandidate;
}

export function saveCandidate(candidate: UpgradeCandidate): UpgradeCandidate {
  mkdirSync(candidate.root, { recursive: true });
  writeFileSync(join(candidate.root, 'candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`);
  return candidate;
}

export function listUpgradeCandidates(base: string): UpgradeCandidate[] {
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(base, d.name, 'candidate.json')))
    .map((d) => readCandidate(join(base, d.name, 'candidate.json')));
}

/** Bounded upgrade repair agent: no shell and writes only compatibility allowlist paths. */
export function makeUpgradeAgentNode(opts: {
  adapter: PiAdapter;
  profile: ProviderProfile;
  model: string;
  candidateRoot: string;
}) {
  return makePiSessionNode({
    name: 'repair_pi_compatibility',
    reads: ['diagnosis'],
    writes: ['repairSummary'],
    tools: ['read', 'grep', 'find', 'write', 'edit'],
    adapter: opts.adapter,
    profile: opts.profile,
    requestedModel: opts.model,
    workspaceRoot: opts.candidateRoot,
    allowMutation: true,
    pathPolicy: upgradePathDecision,
    resultKey: 'repairSummary',
    budget: { maxIterations: 8, maxTokens: 100_000 },
    brief: (reads) =>
      `Repair Pi public-API compatibility only. Do not change policy, acceptance criteria, expected results, promotion, or rollback controls. Diagnosis:\n${String(reads.diagnosis ?? '')}`,
  });
}

function runChecked(command: string, args: string[], cwd: string): { ok: boolean; output: string } {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 10 * 60_000 });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim() };
}

/** Create a real detached git worktree and install the candidate Pi only inside it. */
export function prepareUpgradeWorktree(
  candidate: UpgradeCandidate,
  projectRoot: string,
): { ok: boolean; worktree: string; reason: string } {
  const worktree = join(candidate.root, 'worktree');
  if (existsSync(worktree)) return { ok: false, worktree, reason: 'candidate worktree already exists' };
  const add = runChecked('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], projectRoot);
  if (!add.ok) return { ok: false, worktree, reason: `git worktree failed: ${add.output}` };
  const install = runChecked(
    'npm',
    ['install', '--ignore-scripts', '--save-exact', `@earendil-works/pi-coding-agent@${candidate.toPi}`],
    worktree,
  );
  if (!install.ok) return { ok: false, worktree, reason: `candidate install failed: ${install.output}` };
  return { ok: true, worktree, reason: 'isolated candidate worktree prepared; stable tree unchanged' };
}

export function inspectUpgradeWorktree(candidate: UpgradeCandidate, worktree: string): UpgradeCandidate {
  if (!assertCandidateContained(candidate.root, worktree))
    return saveCandidate({ ...candidate, status: 'blocked' });
  const pkgPath = join(worktree, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json');
  const failures: string[] = [];
  if (!existsSync(pkgPath)) failures.push('candidate Pi package is not installed');
  const pkg = existsSync(pkgPath)
    ? (JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>)
    : {};
  if (String(pkg.version ?? 'missing') !== candidate.toPi)
    failures.push(
      `installed candidate version ${String(pkg.version ?? 'missing')} does not match ${candidate.toPi}`,
    );
  const exportValue = pkg.exports;
  const exports = exportValue && typeof exportValue === 'object' ? Object.keys(exportValue as object) : [];
  const changelog =
    ['CHANGELOG.md', 'CHANGES.md'].find((f) =>
      existsSync(join(worktree, 'node_modules', '@earendil-works', 'pi-coding-agent', f)),
    ) ?? null;
  const lockPath = join(worktree, 'package-lock.json');
  const lockBody = existsSync(lockPath) ? readFileSync(lockPath) : Buffer.from('');
  let packageIntegrity = '';
  try {
    const lock = JSON.parse(lockBody.toString()) as { packages?: Record<string, { integrity?: string }> };
    packageIntegrity = lock.packages?.['node_modules/@earendil-works/pi-coding-agent']?.integrity ?? '';
  } catch {
    failures.push('package lock is not valid JSON');
  }
  if (!packageIntegrity) failures.push('candidate package integrity is missing from lockfile');
  const candidateProbe = probePiPublicExports(worktree);
  const baselineProbe = probePiPublicExports(process.cwd());
  const runtimeExports = candidateProbe.exports;
  const baselineExports = baselineProbe.exports;
  if (!candidateProbe.ok || runtimeExports.length === 0)
    failures.push('candidate public-export/capability probe failed');
  return saveCandidate({
    ...candidate,
    inspection: {
      packageVersion: String(pkg.version ?? 'missing'),
      packageIntegrity,
      exports,
      types: typeof pkg.types === 'string' ? pkg.types : null,
      changelog,
      runtimeExports,
      exportDelta: {
        added: runtimeExports.filter((name) => !baselineExports.includes(name)),
        removed: baselineExports.filter((name) => !runtimeExports.includes(name)),
      },
      failures,
    },
    status: failures.length ? 'blocked' : 'diagnosing',
  });
}

/** Derive upgrade-agent changes from git, never from caller assertions. */
export function captureUpgradeWorktreeChanges(
  candidate: UpgradeCandidate,
  worktree: string,
): UpgradeCandidate {
  if (!assertCandidateContained(candidate.root, worktree))
    return saveCandidate({ ...candidate, status: 'blocked' });
  const diff = runChecked('git', ['status', '--porcelain', '--untracked-files=all'], worktree);
  if (!diff.ok) return saveCandidate({ ...candidate, status: 'blocked' });
  const paths = diff.output
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim())
    .filter((path) => path !== 'package.json' && path !== 'package-lock.json');
  return recordUpgradeChanges(candidate, paths);
}

/** Run the immutable candidate checks twice and consume a separately written audit verdict. */
export function qualifyUpgradeWorktree(
  candidate: UpgradeCandidate,
  worktree: string,
  auditReport: string,
): UpgradeCandidate {
  const captured = captureUpgradeWorktreeChanges(candidate, worktree);
  const commands = [['run', 'build'], ['run', 'check'], ['test']];
  let passes = 0;
  const failures: string[] = [];
  for (let pass = 1; pass <= 2; pass += 1) {
    const ok = commands.every((args) => {
      const result = runChecked('npm', args, worktree);
      if (!result.ok) failures.push(`pass ${pass}: npm ${args.join(' ')}: ${result.output.slice(-500)}`);
      return result.ok;
    });
    if (ok) passes += 1;
  }
  const auditBody = existsSync(auditReport) ? readFileSync(auditReport, 'utf8') : '';
  const auditPass =
    /(?:verdict|result)\s*:\s*(?:authorize|accept|pass)\b/i.test(auditBody) &&
    !/\b(?:reject|return for repair)\b/i.test(auditBody);
  const integrityOk = Boolean(captured.inspection && captured.inspection.failures.length === 0);
  const qualified = qualifyUpgrade(captured, {
    immutableSuite: failures.length === 0,
    passes,
    independentAudit: auditPass ? 'pass' : 'fail',
    integrityOk,
  });
  if (failures.length && qualified.inspection) qualified.inspection.failures.push(...failures);
  if (qualified.status === 'qualified') writeReleaseManifest(worktree, listReleaseFiles(worktree));
  return saveCandidate(qualified);
}
