import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = process.cwd();
const skip = new Set(['.git', 'node_modules', 'dist', '_snapshots', 'work']);
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else files.push(path);
  }
}
walk(root);
const manifest = Object.fromEntries(
  files.map((path) => [relative(root, path), createHash('sha256').update(readFileSync(path)).digest('hex')]),
);
mkdirSync('work/evidence', { recursive: true });
writeFileSync(
  'work/evidence/source-manifest.json',
  JSON.stringify({ schemaVersion: 1, files: manifest }, null, 2),
);
const environment = {
  node: process.version,
  npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
  piProject: JSON.parse(readFileSync('node_modules/@earendil-works/pi-coding-agent/package.json', 'utf8'))
    .version,
  piGlobal: (() => {
    try {
      return execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim();
    } catch {
      return 'unavailable';
    }
  })(),
  gitBranch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
};
writeFileSync('work/evidence/environment.json', JSON.stringify(environment, null, 2));
console.log(`EVIDENCE FINALIZED files=${files.length}`);
