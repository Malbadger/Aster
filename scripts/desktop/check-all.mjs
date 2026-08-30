// CHECK PASS: build shared libs (so consumers resolve @law/contracts via dist),
// then typecheck every desktop workspace with strict TypeScript. LAW Core has
// its own `npm run check` (Biome + tsc); this desktop gate does not re-lint LAW
// Core or the desktop workspaces with LAW Core's Biome style — strict tsc is the
// desktop static gate. A desktop-specific Biome/ESLint config can be added later.
import { run, pass, fail, fileExists } from "./_lib.mjs";

let code = 0;

// Build shared libraries first so dependent typechecks resolve their declarations.
for (const p of ["packages/contracts", "packages/ui", "packages/test-fixtures"]) {
  console.log(`# build lib ${p}`);
  code ||= run("npm", ["--workspace", p, "run", "build"]);
}
if (code !== 0) fail("CHECK", `shared library build failed (exit ${code})`);

const projects = [
  "packages/contracts",
  "packages/ui",
  "packages/test-fixtures",
  "apps/lawd",
  "apps/desktop",
];
for (const p of projects) {
  console.log(`\n# typecheck ${p}`);
  code ||= run("npm", ["--workspace", p, "run", "check"]);
}

// Cross-check that the desktop still compiles against the current LAW Core types.
if (fileExists("tsconfig.json")) {
  console.log("\n# typecheck LAW Core (src/)");
  code ||= run("npx", ["tsc", "-p", "tsconfig.json", "--noEmit"]);
}

if (code !== 0) fail("CHECK", `one or more typechecks failed (exit ${code})`);
pass("CHECK");
