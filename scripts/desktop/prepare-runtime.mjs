// Assemble the self-contained lawd runtime embedded in Linux bundles.
import { cpSync, chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "packaging/runtime");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "app/apps/lawd"), { recursive: true });

cpSync(process.execPath, join(out, "node"));
chmodSync(join(out, "node"), 0o755);
cpSync(join(root, "dist"), join(out, "app/dist"), { recursive: true });
cpSync(join(root, "apps/lawd/dist"), join(out, "app/apps/lawd/dist"), { recursive: true });
cpSync(join(root, "apps/lawd/python"), join(out, "app/apps/lawd/python"), { recursive: true });
cpSync(join(root, "skills"), join(out, "app/skills"), { recursive: true });
const rootPackage = JSON.parse(await (await import("node:fs/promises")).readFile(join(root, "package.json"), "utf8"));
writeFileSync(join(out, "app/package.json"), JSON.stringify({
  name: "law-runtime",
  version: rootPackage.version,
  type: "module",
  private: true,
  dependencies: rootPackage.dependencies,
}, null, 2));
execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: join(out, "app"), stdio: "inherit",
});
mkdirSync(join(out, "python"), { recursive: true });
execFileSync("python3", [
  "-m", "pip", "install", "--disable-pip-version-check", "--no-compile",
  "--ignore-installed", "--no-warn-conflicts",
  "--target", join(out, "python"),
  "-r", join(root, "apps/lawd/python/requirements-antigravity.txt"),
], { stdio: "inherit" });
execFileSync("tar", [
  "-czf", join(out, "antigravity-python.tar.gz"), "-C", join(out, "python"), ".",
], { stdio: "inherit" });
rmSync(join(out, "python"), { recursive: true, force: true });
// Gemini CLI's keyring dependency publishes native binaries for every target.
// This bundle is Linux x86_64 only; leaving foreign ELF files in the AppDir
// makes linuxdeploy inspect (and fail to resolve) musl/ARM dependencies.
const keytarPrebuilds = join(out, "app/node_modules/@github/keytar/prebuilds");
for (const target of [
  "darwin-arm64", "darwin-x64", "linux-arm", "linux-arm64", "linux-armv7l",
  "linux-ia32", "linuxmusl-arm", "linuxmusl-arm64", "linuxmusl-x64",
  "win32-arm64", "win32-ia32", "win32-x64",
]) rmSync(join(keytarPrebuilds, target), { recursive: true, force: true });
mkdirSync(join(out, "app/node_modules/@law/contracts"), { recursive: true });
cpSync(join(root, "packages/contracts/dist"), join(out, "app/node_modules/@law/contracts/dist"), { recursive: true });
cpSync(join(root, "packages/contracts/package.json"), join(out, "app/node_modules/@law/contracts/package.json"));
// Tauri's resource walker can exhaust descriptors on large node_modules trees.
// Ship one immutable archive and expand it into Aster's private data directory
// on first launch, just as we do for the Python SDK runtime.
execFileSync("tar", [
  "-czf", join(out, "app.tar.gz"), "-C", join(out, "app"), ".",
], { stdio: "inherit" });
rmSync(join(out, "app"), { recursive: true, force: true });
const runtimeRevision = createHash("sha256")
  .update(readFileSync(join(out, "app.tar.gz")))
  .update(readFileSync(join(out, "antigravity-python.tar.gz")))
  .digest("hex");
writeFileSync(join(out, "manifest.json"), JSON.stringify({
  node: process.version,
  entry: "app/apps/lawd/dist/main.js",
  antigravitySdk: "0.1.16",
  runtimeRevision,
}, null, 2));
console.log(`RUNTIME PASS path=${out}`);
