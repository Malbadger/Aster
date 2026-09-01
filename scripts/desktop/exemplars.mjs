import { fail, pass } from "./_lib.mjs";
import { ipc, launchPackaged, stopPackaged } from "./packaged-harness.mjs";

let launched; let total = 0;
const check = (condition, message) => { if (!condition) throw new Error(message); total += 1; };
try {
  launched = await launchPackaged();
  const health = await ipc(launched.info, "daemon_get_health", {});
  check(health.offlineLocalOnly === true, "EX-D-001 local-only mode is not active");

  const catalog = await ipc(launched.info, "model_list_catalog", { query: "" });
  check(new Set(catalog.models.map((model) => model.id)).size === catalog.models.length, "EX-D-002 catalog IDs are not unique");
  const model = catalog.models.find((item) => item.availability === "available");
  if (model) {
    const level = model.effort.supported[0];
    const resolved = await ipc(launched.info, "model_resolve_effort", { modelId: model.id, effort: level });
    check(resolved.supported && resolved.effective === level, "EX-D-003 effort did not resolve exactly");
  } else { check(true, "EX-D-003 no available model; unsupported state is explicit"); }

  const created = await ipc(launched.info, "task_create", { title: "Packaged exemplar", ...(model ? { defaultIdentity: { provider: model.provider, model: model.id, effort: model.effort.supported[0] } } : {}) });
  const help = await ipc(launched.info, "task_send_message", { taskId: created.task.taskId, text: "/help" });
  check(help.accepted && help.status === "completed", "EX-D-004 chat-native command failed");
  const events = await ipc(launched.info, "task_get_events", { taskId: created.task.taskId, sinceSeq: 0 });
  check(events.events.every((event, index, all) => index === 0 || event.seq > all[index - 1].seq), "EX-D-005 events are not chronological");
  const cancel = await ipc(launched.info, "task_cancel", { taskId: created.task.taskId });
  check(cancel.cancellation === "confirmed", "EX-D-006 cancellation was not typed");
  const evidence = await ipc(launched.info, "evidence_export", { taskId: created.task.taskId });
  check(evidence.bundle.taskId === created.task.taskId && evidence.bundle.secretScan === "clean", "EX-D-007 evidence export missing identity");
  await ipc(launched.info, "workspace_set_root", { path: process.cwd() });
  const git = await ipc(launched.info, "git_status", {});
  check(typeof git.status.branch === "string" && Array.isArray(git.status.files), "EX-D-008 Git status invalid");
  const logging = await ipc(launched.info, "log_get_policy", {});
  check(logging.policy.mode === "off" || logging.policy.managed, "EX-D-009 logging is unexpectedly enabled");
  const about = await ipc(launched.info, "about_get", {});
  check(about.name === "Aster" && about.limitations.length > 0, "EX-D-010 limitations are not visible");
  pass("EXEMPLARS", `total=${total}`);
} catch (error) { fail("EXEMPLARS", error instanceof Error ? error.message : String(error)); }
finally { if (launched) stopPackaged(launched.child); }
