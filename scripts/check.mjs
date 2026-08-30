import { execFileSync } from 'node:child_process';
const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname });
try {
  run('node', ['scripts/check-imports.mjs']);
  run('npx', ['biome', 'check', 'src', 'tests', 'scripts']);
  run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.check.json']);
} catch (e) {
  console.error('CHECK FAIL');
  process.exit(1);
}
console.log('CHECK PASS');
