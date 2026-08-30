/**
 * Network locality policy (BN-003, REQ-009).
 *
 * In Ollama mode, inference traffic must contact loopback only. Remote-provider or
 * registry traffic is a different scope and requires separate authorization (REQ-010).
 */

import type { ProviderId } from '../types.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

export function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (LOOPBACK_HOSTS.has(h)) return true;
  // 127.0.0.0/8
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

export interface NetworkDecision {
  ok: boolean;
  reason: string;
  code?: 'NON_LOOPBACK_IN_LOCAL' | 'REMOTE_NEEDS_AUTH';
}

/** Parse a host out of a URL or host[:port] string. */
export function hostOf(target: string): string {
  try {
    const u = new URL(target.includes('://') ? target : `http://${target}`);
    return u.hostname;
  } catch {
    return target.split(':')[0] ?? target;
  }
}

/**
 * Decide whether an inference endpoint is allowed for the active provider.
 * Ollama (locality=local): loopback only. Remote providers: allowed only with the
 * remote-provider authorization scope (checked separately by policy/authorization).
 */
export function assertInferenceEndpointAllowed(provider: ProviderId, target: string): NetworkDecision {
  const host = hostOf(target);
  if (provider === 'ollama') {
    if (!isLoopbackHost(host)) {
      return {
        ok: false,
        code: 'NON_LOOPBACK_IN_LOCAL',
        reason: `Ollama mode allows loopback inference only; "${host}" is not loopback (BN-003).`,
      };
    }
    return { ok: true, reason: `Loopback endpoint "${host}" permitted in Ollama mode.` };
  }
  // Remote subscription providers legitimately leave the machine, but only under an
  // explicit remote-provider authorization (REQ-010). The network layer flags it; the
  // authorization layer grants it.
  return {
    ok: false,
    code: 'REMOTE_NEEDS_AUTH',
    reason: `Provider "${provider}" contacts a remote endpoint ("${host}") and requires the 'remote-provider' authorization scope (REQ-010).`,
  };
}
