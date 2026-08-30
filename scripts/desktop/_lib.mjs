// Shared helpers for LAW desktop orchestration scripts.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", encoding: "utf8", ...opts });
  return res.status ?? 1;
}

export function runCapture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

export function have(cmd) {
  return runCapture("bash", ["-lc", `command -v ${cmd}`]).status === 0;
}

export function fileExists(p) {
  return existsSync(p);
}

/** Print a clear NOT-RUN reason and exit non-zero. Never emits a false PASS. */
export function notRun(label, reason) {
  console.error(`${label} NOT-RUN(environment): ${reason}`);
  process.exit(2);
}

export function fail(label, reason) {
  console.error(`${label} FAIL: ${reason}`);
  process.exit(1);
}

export function pass(label, extra = "") {
  console.log(`${label} PASS${extra ? " " + extra : ""}`);
}
