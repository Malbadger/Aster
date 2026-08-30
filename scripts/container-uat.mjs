import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const engine = ['docker', 'podman'].find(
  (name) => spawnSync(name, ['info'], { stdio: 'ignore' }).status === 0,
);
if (!engine) process.exit(77);
const root = mkdtempSync(join(tmpdir(), 'law-container-'));
const name = `law-uat-${process.pid}`;
const run = spawnSync(
  engine,
  [
    'run',
    '--name',
    name,
    '--user',
    '1000:1000',
    '--security-opt',
    'no-new-privileges',
    '--cap-drop',
    'ALL',
    '--network',
    'none',
    '-v',
    `${root}:/work`,
    'node:22-alpine',
    'sh',
    '-c',
    'test "$(id -u)" != 0 && echo container-only > /work/output',
  ],
  { encoding: 'utf8', timeout: 60_000 },
);
const inspect = spawnSync(
  engine,
  ['inspect', name, '--format', '{{.HostConfig.NetworkMode}} {{.Config.User}}'],
  { encoding: 'utf8' },
);
spawnSync(engine, ['rm', '-f', name], { stdio: 'ignore' });
const output = join(root, 'output');
const pass =
  run.status === 0 &&
  inspect.status === 0 &&
  /^none\s+1000:1000\s*$/.test(inspect.stdout) &&
  readFileSync(output, 'utf8').trim() === 'container-only';
if (!pass) {
  process.stderr.write(`container observation failed: ${run.stderr}\n${inspect.stdout}\n`);
  process.exit(1);
}
process.stdout.write('CONTAINER UAT PASS mount=declared network=none user=1000:1000\n');
