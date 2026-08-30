import { mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fail, pass } from "./_lib.mjs";
import { delay, ipc, launchPackaged, stopPackaged } from "./packaged-harness.mjs";

let launched;
try {
  launched = await launchPackaged();
  const health = await ipc(launched.info, "daemon_get_health", {});
  const probe = await ipc(launched.info, "daemon_probe_capabilities", { refresh: false });
  const mode = statSync(launched.info.socketPath).mode & 0o777;
  if (mode & 0o077) throw new Error(`daemon socket permissions are ${mode.toString(8)}, expected owner-only`);
  await delay(5000);
  mkdirSync("work/evidence/law-desktop/screenshots", { recursive: true });
  spawnSync("gnome-screenshot", ["-w", "-f", "work/evidence/law-desktop/screenshots/packaged-smoke.png"]);
  pass("DESKTOP SMOKE", `artifact=${launched.artifact.path} daemon=${health.daemonVersion} capabilities=${probe.capabilities.length}`);
} catch (error) {
  fail("DESKTOP SMOKE", error instanceof Error ? error.message : String(error));
} finally {
  if (launched) stopPackaged(launched.child);
}
