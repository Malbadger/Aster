/**
 * Logging contracts (BUILD-D-017, REQ-D-038..040). Community operational/audit
 * logging is OFF by default and user-controlled. A valid managed policy may
 * REQUIRE visibly-disclosed logging that users can inspect but not override
 * (RULE-D-005). Credentials and configured secret patterns are NEVER logged in
 * any mode; redaction failure fails closed. Remote export stays behind an
 * adapter (OPEN-D-004 provisional: local JSONL only).
 */
import { z } from "zod";
import { defineOperation } from "./ipc.js";

export const LogMode = z.enum(["off", "user", "managed"]);
export type LogMode = z.infer<typeof LogMode>;

export const LogPolicy = z.object({
  mode: LogMode,
  /** True when set by a managed administrator; users may inspect but not override. */
  managed: z.boolean(),
  fields: z.array(z.string()),
  retentionDays: z.number().int().positive(),
  /** Provisional (OPEN-D-004): local JSONL only; remote export behind an adapter, none enabled. */
  destination: z.enum(["none", "local-jsonl"]),
});
export type LogPolicy = z.infer<typeof LogPolicy>;

export const log_get_policy = defineOperation({
  name: "log_get_policy",
  schemaVersion: 1,
  summary: "Get the effective logging policy (always visible in settings/status).",
  consequential: false,
  request: z.object({}).strict(),
  response: z.object({ policy: LogPolicy }),
});

export const log_set_policy = defineOperation({
  name: "log_set_policy",
  schemaVersion: 1,
  summary: "Set community logging (refused when a managed policy is in force).",
  consequential: true,
  request: z.object({
    mode: z.enum(["off", "user"]),
    fields: z.array(z.string()).default([]),
    retentionDays: z.number().int().positive().default(30),
    destination: z.enum(["none", "local-jsonl"]).default("local-jsonl"),
  }),
  response: z.object({ policy: LogPolicy, refused: z.boolean(), reason: z.string().optional() }),
});
