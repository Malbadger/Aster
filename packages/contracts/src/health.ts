/**
 * Daemon health + capability-probe contracts (BUILD-D-003, REQ-D-002/005).
 *
 * The capability probe distinguishes the four states the kit requires:
 * `ready`, `missing`, `incompatible`, `unavailable` — plus `optional` marking.
 * No silent download or install is ever implied by a probe result.
 */
import { z } from "zod";
import { defineOperation } from "./ipc.js";

export const CapabilityState = z.enum(["ready", "missing", "incompatible", "unavailable"]);
export type CapabilityState = z.infer<typeof CapabilityState>;

/** A probed external capability (LAW Core, Pi, Ollama, Git, container, ...). */
export const CapabilityReport = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  state: CapabilityState,
  /** True when the product is fully usable without this capability. */
  optional: z.boolean(),
  /** Detected version, when known. Never a credential. */
  detectedVersion: z.string().optional(),
  /** Minimum version LAW qualified against, when applicable. */
  requiredVersion: z.string().optional(),
  /** Secret-free explanation and, for non-ready states, a recovery hint. */
  detail: z.string(),
  recovery: z.string().optional(),
});
export type CapabilityReport = z.infer<typeof CapabilityReport>;

export const DaemonHealth = z.object({
  daemonVersion: z.string(),
  protocol: z.number().int().positive(),
  dataSchemaVersion: z.number().int().positive(),
  /** Milliseconds since the daemon started. */
  uptimeMs: z.number().nonnegative(),
  /** True only when external egress is blocked to non-loopback (RULE-D-006). */
  offlineLocalOnly: z.boolean(),
});
export type DaemonHealth = z.infer<typeof DaemonHealth>;

export const CapabilityProbe = z.object({
  probedAt: z.string(), // ISO-8601
  capabilities: z.array(CapabilityReport),
});
export type CapabilityProbe = z.infer<typeof CapabilityProbe>;

/** GET daemon health. Non-consequential, always available once authenticated. */
export const daemon_get_health = defineOperation({
  name: "daemon_get_health",
  schemaVersion: 1,
  summary: "Return daemon version, protocol, uptime, and local-only mode.",
  consequential: false,
  request: z.object({}).strict(),
  response: DaemonHealth,
});

/** Run the first-run capability probe. Read-only; performs no install. */
export const daemon_probe_capabilities = defineOperation({
  name: "daemon_probe_capabilities",
  schemaVersion: 1,
  summary: "Probe LAW Core, Pi, local model endpoints, Git, and container capability.",
  consequential: false,
  request: z.object({ refresh: z.boolean().default(false) }),
  response: CapabilityProbe,
});
