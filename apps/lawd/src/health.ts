import type { DaemonHealth } from "@law/contracts";
import { DESKTOP_VERSION, DATA_SCHEMA_VERSION, PROTOCOL_VERSION } from "@law/contracts";

/** Monotonic-ish start reference for uptime reporting. */
const startedAt = Date.now();

export interface HealthInputs {
  /** True when the effective policy blocks non-loopback egress (RULE-D-006). */
  offlineLocalOnly: boolean;
  now?: () => number;
}

/** Build the current daemon health snapshot. Pure and secret-free. */
export function buildHealth(inputs: HealthInputs): DaemonHealth {
  const now = inputs.now ?? Date.now;
  return {
    daemonVersion: DESKTOP_VERSION,
    protocol: PROTOCOL_VERSION,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    uptimeMs: Math.max(0, now() - startedAt),
    offlineLocalOnly: inputs.offlineLocalOnly,
  };
}
