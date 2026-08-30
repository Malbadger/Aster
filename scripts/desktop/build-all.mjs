// BUILD PASS: build LAW Core, shared packages, daemon, and desktop frontend.
import { run, pass, fail, fileExists } from "./_lib.mjs";

let code = 0;

// LAW Core first (existing dist consumed by lawd), if present.
if (fileExists("tsconfig.json")) {
  console.log("# build LAW Core (src/)");
  code ||= run("npx", ["tsc", "-p", "tsconfig.json"]);
}

for (const p of ["packages/contracts", "packages/ui", "packages/test-fixtures", "apps/lawd"]) {
  console.log(`\n# build ${p}`);
  code ||= run("npm", ["--workspace", p, "run", "build"]);
}

console.log("\n# build desktop frontend");
code ||= run("npm", ["--workspace", "apps/desktop", "run", "build"]);

if (code !== 0) fail("BUILD", `build failed (exit ${code})`);
pass("BUILD");
