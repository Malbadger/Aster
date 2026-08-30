import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const cwd = new URL('..', import.meta.url).pathname;
try {
  execFileSync('npx', ['vitest', 'run', '--reporter=json', '--outputFile=work/evidence/vitest-report.json'], {
    stdio: 'inherit',
    cwd,
  });
} catch {
  console.error('TEST FAIL');
  process.exit(1);
}
let total = 0;
try {
  const rep = JSON.parse(readFileSync(new URL('../work/evidence/vitest-report.json', import.meta.url)));
  total = rep.numTotalTests ?? 0;
  if ((rep.numFailedTests ?? 0) > 0) {
    console.error('TEST FAIL');
    process.exit(1);
  }
} catch {}
console.log(`TEST PASS total=${total}`);
