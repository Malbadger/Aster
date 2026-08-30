import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const { runUatBattery, renderUat } = await import('../dist/uat/index.js');
mkdirSync('work/evidence/uat', { recursive: true });
let ok = true;
const digest = (v) => createHash('sha256').update(v).digest('hex');
const controlledHashes = () => {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((f) => f && !f.startsWith('work/'));
  const source = files.map((f) => `${f}\0${digest(readFileSync(f))}`).join('\n');
  return {
    source: digest(source),
    dependency: digest(readFileSync('package-lock.json')),
    pi: digest(readFileSync('node_modules/@earendil-works/pi-coding-agent/package.json')),
    adapter: digest(
      files
        .filter((f) => f.startsWith('src/pi-adapter/'))
        .map((f) => readFileSync(f))
        .join('\n'),
    ),
    fixtures: digest(
      files
        .filter((f) => f.startsWith('benchmarks/'))
        .map((f) => readFileSync(f))
        .join('\n'),
    ),
  };
};
const passes = [];
for (const pass of [1, 2]) {
  const before = controlledHashes();
  const rows = runUatBattery({ cleanInstall: true });
  const output = renderUat(rows, pass);
  console.log(output);
  const after = controlledHashes();
  const artifactHash = digest(
    JSON.stringify(
      rows.map((r) => ({ id: r.id, result: r.result, command: r.command, exitCode: r.exitCode })),
    ),
  );
  const evidence = {
    pass,
    before,
    after,
    controlledUnchanged: JSON.stringify(before) === JSON.stringify(after),
    artifactHash,
    rows,
  };
  passes.push(evidence);
  writeFileSync(resolve(`work/evidence/uat/pass-${pass}.json`), JSON.stringify(evidence, null, 2));
  if (rows.some((r) => r.result === 'FAIL')) ok = false;
  if (!evidence.controlledUnchanged) ok = false;
}
if (
  JSON.stringify(passes[0].before) !== JSON.stringify(passes[1].before) ||
  passes[0].artifactHash !== passes[1].artifactHash
) {
  console.error('UAT FAIL: two-pass controlled or artifact hashes differ');
  ok = false;
} else
  console.log(
    `TWO-PASS CLOSURE PASS controlled=${passes[0].before.source} artifact=${passes[0].artifactHash}`,
  );
if (!ok) process.exit(1);
