// RELEASE AUDIT PASS: planted-secret scan + SBOM + license inventory.
// Real and runnable now (does not require the packaged app). Fails closed on any
// secret finding, reporting field PATHS/line numbers — never the secret value.
import { runCapture, pass, fail } from "./_lib.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const EVID = "work/evidence/law-desktop";
mkdirSync(EVID, { recursive: true });

// --- Secret patterns (mirror apps/lawd Redactor built-ins) ---
const PATTERNS = [
  ["private-key-block", /-----BEGIN[ A-Z]*PRIVATE KEY-----/],
  ["aws-access-key-id", /\bAKIA[0-9A-Z]{16}\b/],
  ["openai-key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["github-token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];
// Test fixtures deliberately contain planted fakes; they are excluded from the release scan.
const EXCLUDE = /(^|\/)(node_modules|dist|target|\.git|work)\/|\.test\.tsx?$|redaction\.ts$|release-audit\.mjs$/;

function trackedFiles() {
  // Candidate source is often audited before its first commit. Include tracked,
  // modified, and untracked non-ignored files so a green scan cannot omit the
  // very desktop code being released.
  const r = runCapture("git", ["ls-files", "-co", "--exclude-standard"]);
  if (r.status === 0 && r.stdout.trim()) return r.stdout.split("\n").filter(Boolean);
  return [];
}

const findings = [];
for (const f of trackedFiles()) {
  if (EXCLUDE.test(f) || !existsSync(f)) continue;
  let text;
  try {
    if (statSync(f).size > 2_000_000) continue;
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const [name, re] of PATTERNS) {
      if (re.test(line)) findings.push({ file: f, line: i + 1, pattern: name });
    }
  });
}
writeFileSync(join(EVID, "secret-scan.json"), JSON.stringify({ scannedAt: new Date().toISOString(), findings }, null, 2));

// --- SBOM (npm) ---
const sbom = { generatedAt: new Date().toISOString(), npm: [], cargo: [] };
if (existsSync("package-lock.json")) {
  try {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
      if (!path || !pkg?.version) continue;
      sbom.npm.push({ name: path.replace(/^node_modules\//, "") || lock.name, version: pkg.version, ...(pkg.license ? { license: pkg.license } : {}) });
    }
  } catch { /* ignore */ }
}
const cargoLock = "apps/desktop/src-tauri/Cargo.lock";
if (existsSync(cargoLock)) {
  for (const m of readFileSync(cargoLock, "utf8").matchAll(/name = "([^"]+)"\nversion = "([^"]+)"/g)) {
    sbom.cargo.push({ name: m[1], version: m[2] });
  }
}
writeFileSync(join(EVID, "sbom.json"), JSON.stringify(sbom, null, 2));

// --- License inventory (best-effort from installed npm packages) ---
const licenses = {};
for (const dep of sbom.npm) {
  if (dep.license) licenses[dep.license] = (licenses[dep.license] ?? 0) + 1;
}
writeFileSync(join(EVID, "licenses.json"), JSON.stringify({ counts: licenses, npmPackages: sbom.npm.length, cargoCrates: sbom.cargo.length }, null, 2));

console.log(`secret scan: ${findings.length} finding(s); SBOM: ${sbom.npm.length} npm + ${sbom.cargo.length} cargo; evidence in ${EVID}/`);
if (findings.length > 0) {
  for (const f of findings) console.error(`  SECRET ${f.pattern} at ${f.file}:${f.line}`);
  fail("RELEASE AUDIT", `${findings.length} secret finding(s) — release blocked (zero tolerance)`);
}
pass("RELEASE AUDIT", `npm=${sbom.npm.length} cargo=${sbom.cargo.length}`);
