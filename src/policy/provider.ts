/**
 * Provider/model policy (BUILD-003, RULE-002).
 *
 * The Claude Max denial is a hard, non-configurable rule: any model whose name
 * matches /claude.*max/i is denied case-insensitively, before any provider call
 * (DEC-005, REQ-007, EX-004). Profiles may further restrict via allow/deny globs.
 */

import type { ProviderId, ProviderProfile } from '../types.js';

/** Hard denial pattern for Claude Max — case-insensitive, substring, un-overridable. */
export const CLAUDE_MAX_RE = /claude.*max/i;

export function isClaudeMax(model: string): boolean {
  return CLAUDE_MAX_RE.test(model);
}

/** Minimal case-insensitive glob: supports `*` (any run) and exact tokens. */
export function globMatch(pattern: string, value: string): boolean {
  const rx = new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
    'i',
  );
  return rx.test(value);
}

export interface PolicyDecision {
  ok: boolean;
  reason: string;
  code?: 'CLAUDE_MAX_DENIED' | 'DENYLIST' | 'NOT_ALLOWLISTED' | 'PROVIDER_MISMATCH';
}

/**
 * Decide whether a requested model is permitted under a profile.
 * Order: Claude Max hard-deny → explicit deny globs → allowlist → default allow.
 */
export function assertModelAllowed(profile: ProviderProfile, model: string): PolicyDecision {
  if (isClaudeMax(model)) {
    return {
      ok: false,
      code: 'CLAUDE_MAX_DENIED',
      reason: `Claude Max is denied by owner policy (DEC-005); "${model}" matches /claude.*max/i.`,
    };
  }
  for (const d of profile.modelPolicy.deny) {
    if (globMatch(d, model)) {
      return { ok: false, code: 'DENYLIST', reason: `Model "${model}" matches profile denylist "${d}".` };
    }
  }
  if (profile.modelPolicy.allow.length > 0) {
    const allowed = profile.modelPolicy.allow.some((a) => globMatch(a, model));
    if (!allowed) {
      return {
        ok: false,
        code: 'NOT_ALLOWLISTED',
        reason: `Model "${model}" is not in profile allowlist [${profile.modelPolicy.allow.join(', ')}].`,
      };
    }
  }
  return { ok: true, reason: `Model "${model}" permitted for provider "${profile.provider}".` };
}

/** Guard a mid-run change request (REQ-008): provider/model may not change within a run. */
export function assertNoProviderSwitch(
  locked: { provider: ProviderId; model: string },
  requested: { provider: ProviderId; model: string },
): PolicyDecision {
  if (locked.provider !== requested.provider || locked.model !== requested.model) {
    return {
      ok: false,
      code: 'PROVIDER_MISMATCH',
      reason: `Provider/model is immutable within a run (REQ-008): locked ${locked.provider}/${locked.model}, requested ${requested.provider}/${requested.model}.`,
    };
  }
  return { ok: true, reason: 'No provider switch.' };
}
