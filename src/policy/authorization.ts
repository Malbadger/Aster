/**
 * Separate-authorization scopes (REQ-010).
 *
 * Package-registry access and remote-provider runs each require an EXPLICIT scope that
 * is not implied by starting a run. A request needing a scope that was not granted is
 * blocked with a clear recovery action (EXP-002, "DATA LEAVES THIS MACHINE").
 */

export type AuthorizationScope = 'registry' | 'remote-provider';

export interface AuthorizationDecision {
  ok: boolean;
  reason: string;
  scope: AuthorizationScope;
  recovery?: string;
}

export class RunAuthorization {
  private readonly granted: Set<AuthorizationScope>;
  constructor(granted: Iterable<AuthorizationScope> = []) {
    this.granted = new Set(granted);
  }

  has(scope: AuthorizationScope): boolean {
    return this.granted.has(scope);
  }

  assert(scope: AuthorizationScope): AuthorizationDecision {
    if (this.granted.has(scope)) {
      return { ok: true, scope, reason: `Scope "${scope}" is granted for this run.` };
    }
    const recovery =
      scope === 'registry'
        ? 'Re-run with `--allow registry` (or configure it) to permit npm registry access. This is off by default.'
        : 'Re-run with `--allow remote-provider` to permit remote-provider network egress. DATA LEAVES THIS MACHINE.';
    return {
      ok: false,
      scope,
      reason: `Scope "${scope}" was not granted for this run (REQ-010).`,
      recovery,
    };
  }
}
