/**
 * Deterministic verification node (REQ-022, RULE-004, BN-008).
 *
 * Runs declared checks (plain functions — T0, no model). "ready" requires ALL required
 * checks to pass and no blocking outcome. A failure routes to bounded repair or human
 * handoff; it never silently becomes ready.
 */

import type { NodeContract, NodeResult, RunState } from './types.js';

export interface Check {
  name: string;
  required: boolean;
  run: (data: Record<string, unknown>) => { pass: boolean; detail: string };
}

export interface VerificationResult {
  ready: boolean;
  checks: Array<{ name: string; required: boolean; pass: boolean; detail: string }>;
}

export interface VerifyNodeOptions {
  name: string;
  reads: string[];
  checks: Check[];
  /** state.data key that receives the VerificationResult. */
  resultKey: string;
}

/** RULE-004 closure: ready = all required checks passed. */
export function readyGate(result: VerificationResult): boolean {
  return result.checks.filter((c) => c.required).every((c) => c.pass);
}

export function makeVerifyNode(opts: VerifyNodeOptions): NodeContract {
  return {
    name: opts.name,
    reads: opts.reads,
    writes: [opts.resultKey],
    tier: 'T0',
    run(ctx): NodeResult {
      const checks = opts.checks.map((c) => {
        const r = c.run(ctx.reads);
        return { name: c.name, required: c.required, pass: r.pass, detail: r.detail };
      });
      const result: VerificationResult = { ready: false, checks };
      result.ready = readyGate(result);
      return {
        status: 'ok',
        writes: { [opts.resultKey]: result },
        summary: { ready: result.ready, failed: checks.filter((c) => !c.pass).map((c) => c.name) },
      };
    },
  };
}

/** Router helper: read a VerificationResult from state and branch ready/repair. */
export function verificationRouter(resultKey: string): (state: RunState) => string {
  return (state) => {
    const r = state.data[resultKey] as VerificationResult | undefined;
    return r?.ready ? 'ready' : 'repair';
  };
}
