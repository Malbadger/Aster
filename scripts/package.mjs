import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
mkdirSync('work/dist', { recursive: true });
const packed = execFileSync('npm', ['pack', '--silent', '--pack-destination', 'work/dist'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .at(-1);
if (!packed) throw new Error('npm pack produced no artifact');
const artifact = resolve('work/dist', packed);
const sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex');
const manifest = { artifact, sha256, createdAt: new Date().toISOString() };
writeFileSync('work/dist/manifest.json', JSON.stringify(manifest, null, 2));
console.log(`PACKAGE PASS manifest=${resolve('work/dist/manifest.json')}`);
