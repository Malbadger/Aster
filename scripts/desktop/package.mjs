// PACKAGE PASS: build AppImage + .deb via Tauri, emit SHA-256 + manifest.
// Requires the Tauri Linux toolchain (Rust + webkit2gtk-4.1 + packaging tools).
// Fails closed with NOT-RUN(environment) when the toolchain is absent — it
// never fabricates a PASS. Full SBOM/license inventory is added in BUILD-D-022.
import { run, runCapture, have, notRun, fail, pass } from "./_lib.mjs";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

if (!have("cargo")) notRun("PACKAGE", "cargo/Rust toolchain not found");
const wk = runCapture("bash", ["-lc", "pkg-config --exists webkit2gtk-4.1 && echo ok"]);
if (!wk.stdout.includes("ok")) {
  notRun("PACKAGE", "webkit2gtk-4.1 dev libraries not found (required by Tauri on Linux)");
}

let sourceBuild = run("npm", ["run", "build:all"]);
if (sourceBuild !== 0) fail("PACKAGE", `production source build failed (exit ${sourceBuild})`);
let themes = run("npx", ["vsce", "package", "--no-dependencies", "--skip-license", "--allow-missing-repository", "--out", "../law-workbench-themes.vsix"], {
  cwd: "apps/desktop/src-tauri/resources/law-themes",
});
if (themes !== 0) fail("PACKAGE", `LAW editor theme packaging failed (exit ${themes})`);
let prep = run("node", ["scripts/desktop/prepare-runtime.mjs"]);
if (prep !== 0) fail("PACKAGE", `runtime preparation failed (exit ${prep})`);

let code = run("npm", ["--workspace", "apps/desktop", "run", "tauri", "--", "build"]);
if (code !== 0) fail("PACKAGE", `tauri build failed (exit ${code})`);

const bundleDir = "apps/desktop/src-tauri/target/release/bundle";
if (!existsSync(bundleDir)) fail("PACKAGE", `no bundle directory at ${bundleDir}`);

const artifacts = [];
for (const kind of ["deb", "appimage"]) {
  const dir = join(bundleDir, kind);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".deb") || f.endsWith(".AppImage")) {
      const p = join(dir, f);
      const sha = createHash("sha256").update(readFileSync(p)).digest("hex");
      artifacts.push({ path: p, sha256: sha });
    }
  }
}
if (artifacts.length === 0) fail("PACKAGE", "no .deb or .AppImage produced");

mkdirSync("work/evidence/law-desktop", { recursive: true });
writeFileSync(
  "work/evidence/law-desktop/package-manifest.json",
  JSON.stringify({ builtAt: new Date().toISOString(), artifacts }, null, 2),
);
for (const a of artifacts) console.log(`${a.sha256}  ${a.path}`);
pass("PACKAGE", `artifacts=${artifacts.length}`);
