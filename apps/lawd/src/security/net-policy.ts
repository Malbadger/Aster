/**
 * Network locality policy (RULE-D-006, REQ-D-009). Mirrors LAW Core
 * `policy/network.ts` loopback logic, provider-neutral. In local-only mode only
 * loopback endpoints are permitted; a non-loopback target is BLOCKED (not
 * queued). Remote egress requires an explicit, separately authorized action.
 */
import type { NetCheck } from "@law/contracts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(h)) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

export function hostOf(target: string): string {
  try {
    const u = new URL(target.includes("://") ? target : `http://${target}`);
    return u.hostname;
  } catch {
    return target.split(":")[0] ?? target;
  }
}

export interface NetPolicyState {
  offlineLocalOnly: boolean;
  /** True only after a separate, visible remote-egress authorization. */
  remoteAuthorized: boolean;
}

export function checkEndpoint(target: string, state: NetPolicyState): NetCheck {
  const host = hostOf(target);
  if (isLoopbackHost(host)) {
    return { target, allowed: true, code: "LOOPBACK_OK", reason: `Loopback endpoint "${host}" permitted.` };
  }
  if (state.offlineLocalOnly) {
    return {
      target,
      allowed: false,
      code: "OFFLINE_NON_LOOPBACK",
      reason: `Local-only mode: "${host}" is not loopback; the request is blocked, not queued (RULE-D-006).`,
    };
  }
  if (!state.remoteAuthorized) {
    return {
      target,
      allowed: false,
      code: "REMOTE_NEEDS_AUTH",
      reason: `"${host}" is remote and requires an explicit remote-egress authorization before data leaves this machine.`,
    };
  }
  return { target, allowed: true, code: "REMOTE_OK", reason: `Remote endpoint "${host}" permitted by explicit authorization.` };
}
