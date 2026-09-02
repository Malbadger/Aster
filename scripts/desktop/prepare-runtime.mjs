// Assemble the self-contained lawd runtime embedded in Linux bundles.
import { cpSync, chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "packaging/runtime");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "app/apps/lawd"), { recursive: true });

cpSync(process.execPath, join(out, "node"));
chmodSync(join(out, "node"), 0o755);
cpSync(join(root, "dist"), join(out, "app/dist"), { recursive: true });
cpSync(join(root, "apps/lawd/dist"), join(out, "app/apps/lawd/dist"), { recursive: true });
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
writeFileSync(join(out, "manifest.json"), JSON.stringify({ node: process.version, entry: "app/apps/lawd/dist/main.js" }, null, 2));
console.log(`RUNTIME PASS path=${out}`);
