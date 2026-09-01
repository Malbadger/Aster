/**
 * @law/contracts — single typed source of truth for Aster desktop IPC.
 *
 * Everything the UI and daemon exchange is defined here and validated at
 * runtime on both sides. Add new operations in their domain module and export
 * them through this barrel; register them in the daemon's contract registry.
 */
export * from "./ipc.js";
export * from "./version.js";
export * from "./health.js";
export * from "./model.js";
export * from "./model-order.js";
export * from "./provider.js";
export * from "./task.js";
export * from "./editor.js";
export * from "./git.js";
export * from "./logging.js";
export * from "./evidence.js";
export * from "./system.js";
export * from "./workspace.js";

import { ContractRegistry } from "./ipc.js";
import { daemon_get_health, daemon_probe_capabilities } from "./health.js";
import { model_list_catalog, model_set_favorite, model_resolve_effort } from "./model.js";
import {
  provider_list_connections,
  provider_add_connection,
  provider_remove_connection,
  provider_set_enabled,
  provider_check_credential,
  provider_auth_methods, provider_auth_start, provider_auth_get, provider_auth_respond, provider_auth_cancel, provider_auth_logout, provider_gemini_cli_status,
  net_check_endpoint,
} from "./provider.js";
import {
  task_create,
  task_list,
  task_get,
  task_send_message,
  task_get_events,
  task_cancel,
  task_respond_approval,
  task_delete,
} from "./task.js";
import {
  fs_read_file,
  fs_write_file,
  verify_run,
  verify_get_status,
  autocomplete_get_config,
  autocomplete_set_config,
  autocomplete_complete,
} from "./editor.js";
import { git_status, git_stage, git_commit, git_create_branch, git_remote_action } from "./git.js";
import { log_get_policy, log_set_policy } from "./logging.js";
import { evidence_export } from "./evidence.js";
import { update_check, update_stage, migration_status, migration_run, plugin_list, about_get } from "./system.js";
import { workspace_get_root, workspace_set_root } from "./workspace.js";

/** The canonical registry of all known operations. */
export function createContractRegistry(): ContractRegistry {
  const r = new ContractRegistry();
  r.register(daemon_get_health);
  r.register(daemon_probe_capabilities);
  r.register(model_list_catalog);
  r.register(model_set_favorite);
  r.register(model_resolve_effort);
  r.register(provider_list_connections);
  r.register(provider_add_connection);
  r.register(provider_remove_connection);
  r.register(provider_set_enabled);
  r.register(provider_check_credential);
  r.register(provider_auth_methods);
  r.register(provider_auth_start);
  r.register(provider_auth_get);
  r.register(provider_auth_respond);
  r.register(provider_auth_cancel);
  r.register(provider_auth_logout);
  r.register(provider_gemini_cli_status);
  r.register(net_check_endpoint);
  r.register(task_create);
  r.register(task_list);
  r.register(task_get);
  r.register(task_send_message);
  r.register(task_get_events);
  r.register(task_cancel);
  r.register(task_respond_approval);
  r.register(task_delete);
  r.register(fs_read_file);
  r.register(fs_write_file);
  r.register(verify_run);
  r.register(verify_get_status);
  r.register(autocomplete_get_config);
  r.register(autocomplete_set_config);
  r.register(autocomplete_complete);
  r.register(git_status);
  r.register(git_stage);
  r.register(git_commit);
  r.register(git_create_branch);
  r.register(git_remote_action);
  r.register(log_get_policy);
  r.register(log_set_policy);
  r.register(evidence_export);
  r.register(update_check);
  r.register(update_stage);
  r.register(migration_status);
  r.register(migration_run);
  r.register(plugin_list);
  r.register(about_get);
  r.register(workspace_get_root);
  r.register(workspace_set_root);
  return r;
}
