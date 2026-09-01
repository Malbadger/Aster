// TEST PASS total=<n>: desktop workspace tests (contracts, ui, test-fixtures,
// lawd, desktop) via the dedicated desktop Vitest config. Aster Core keeps its
// own `npm test` (scripts/test.mjs); this runner does not touch it.
import { runCapture, pass, fail } from "./_lib.mjs";
import { readFileSync, mkdirSync } from "node:fs";

mkdirSync("work/evidence/law-desktop", { recursive: true });
const out = "work/evidence/law-desktop/vitest-desktop.json";
const res = runCapture("npx", [
  "vitest",
  "run",
  "--config",
  "vitest.desktop.config.ts",
  "--reporter=default",
  "--reporter=json",
  `--outputFile=${out}`,
]);
process.stdout.write(res.stdout);
process.stderr.write(res.stderr);

let total = 0;
let failed = 0;
try {
  const report = JSON.parse(readFileSync(out, "utf8"));
  total = report.numTotalTests ?? 0;
  failed = report.numFailedTests ?? 0;
} catch {
  /* best-effort count */
}

if (res.status !== 0 || failed > 0) fail("TEST", `desktop tests failed (exit ${res.status}, failed ${failed})`);
pass("TEST", `total=${total}`);
