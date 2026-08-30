// Static guard (REQ-003): no source file may import Pi internal dist/** paths,
// and no source file may treat Pi terminal output as an API. Only the three
// public Pi entry points are allowed, and only inside src/pi-adapter/**.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const ALLOWED_PI = new Set([
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-coding-agent/client',
  '@earendil-works/pi-coding-agent/rpc-entry',
]);
const ADAPTER_PREFIX = join('src', 'pi-adapter');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const violations = [];
const importRe =
  /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  const matches = text.matchAll(importRe);
  for (const m of matches) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    // Any @earendil-works/pi-coding-agent/dist/** or deep internal path is forbidden.
    if (spec.startsWith('@earendil-works/pi-coding-agent/')) {
      if (!ALLOWED_PI.has(spec)) {
        violations.push(`${rel}: forbidden Pi internal import "${spec}" (REQ-003)`);
        continue;
      }
    }
    // Sibling @earendil-works/pi-* packages are Pi internals reached only through the adapter's public deps.
    if (spec.startsWith('@earendil-works/pi-coding-agent') || ALLOWED_PI.has(spec)) {
      const inAdapter = rel.startsWith(ADAPTER_PREFIX);
      if (!inAdapter) {
        violations.push(
          `${rel}: Pi import "${spec}" outside src/pi-adapter/** — all Pi access must go through the PiAdapter (REQ-002)`,
        );
      }
    }
  }
  // Reject terminal-output-parsing-as-API heuristics: stripping ANSI from Pi output to extract data.
  if (/\\x1b\[|\\u001b\[|ansi-?regex|strip-?ansi/i.test(text) && rel.startsWith('src/pi-adapter')) {
    // allowed only if explicitly annotated; adapter must consume structured events, not rendered text
    if (!/ALLOW_TERMINAL_RENDER_OK/.test(text)) {
      violations.push(`${rel}: appears to parse terminal/ANSI output as an API (REQ-003)`);
    }
  }
}

if (violations.length) {
  console.error('IMPORT-GUARD FAIL');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log('IMPORT-GUARD PASS (public Pi boundary intact)');
