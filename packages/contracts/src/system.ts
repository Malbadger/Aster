/**
 * System contracts (BUILD-D-018/019/021, REQ-D-041..043,045). Updates,
 * migrations/rollback, the plugin extension contract, and honest About/limits.
 *
 * OPEN-D-003 (provisional): updates are checked against signed/checksummed
 * release metadata only, staged without replacing the running release, and
 * NEVER auto-applied while unsigned. Migrations are transactional with rollback.
 * Plugins declare an API version and least-privilege permissions; incompatible
 * plugins are disabled with a reason. About reports limitations honestly.
 */
import { z } from "zod";
import { defineOperation } from "./ipc.js";

// ---- Updates (REQ-D-041) ----
export const UpdateInfo = z.object({
  version: z.string(),
  source: z.string(),
  sha256: z.string(),
  signaturePresent: z.boolean(),
  compatible: z.boolean(),
});
export type UpdateInfo = z.infer<typeof UpdateInfo>;

export const update_check = defineOperation({
  name: "update_check",
  schemaVersion: 1,
  summary: "Check release metadata (manual, checksummed). Never auto-applies.",
  consequential: false,
  request: z.object({}).strict(),
  response: z.object({ available: z.boolean(), info: UpdateInfo.optional(), reason: z.string().optional() }),
});

export const update_stage = defineOperation({
  name: "update_stage",
  schemaVersion: 1,
  summary: "Stage a verified update without replacing the running release.",
  consequential: true,
  request: z.object({ version: z.string().min(1) }),
  response: z.object({ staged: z.boolean(), reason: z.string().optional() }),
});

// ---- Migrations (REQ-D-042) ----
export const migration_status = defineOperation({
  name: "migration_status",
  schemaVersion: 1,
  summary: "Report data schema version and whether a migration is pending.",
  consequential: false,
  request: z.object({}).strict(),
  response: z.object({ schemaVersion: z.number().int(), targetVersion: z.number().int(), pending: z.boolean() }),
});

export const migration_run = defineOperation({
  name: "migration_run",
  schemaVersion: 1,
  summary: "Run pending migrations transactionally; roll back on failure.",
  consequential: true,
  request: z.object({}).strict(),
  response: z.object({ ok: z.boolean(), from: z.number().int(), to: z.number().int(), rolledBack: z.boolean(), reason: z.string().optional() }),
});

// ---- Plugins (REQ-D-043) ----
export const PluginManifest = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  apiVersion: z.number().int().positive(),
  permissions: z.array(z.string()),
});
export type PluginManifest = z.infer<typeof PluginManifest>;

export const PluginState = z.object({
  manifest: PluginManifest,
  compatible: z.boolean(),
  enabled: z.boolean(),
  reason: z.string().optional(),
});
export type PluginState = z.infer<typeof PluginState>;

export const plugin_list = defineOperation({
  name: "plugin_list",
  schemaVersion: 1,
  summary: "List plugins with compatibility and least-privilege status.",
  consequential: false,
  request: z.object({}).strict(),
  response: z.object({ plugins: z.array(PluginState), apiVersion: z.number().int() }),
});

// ---- About / limitations (REQ-D-045) ----
export const about_get = defineOperation({
  name: "about_get",
  schemaVersion: 1,
  summary: "Report product identity, version, and honest limitations.",
  consequential: false,
  request: z.object({}).strict(),
  response: z.object({
    name: z.string(),
    version: z.string(),
    limitations: z.array(z.string()),
    humanOnlyGates: z.array(z.string()),
  }),
});
