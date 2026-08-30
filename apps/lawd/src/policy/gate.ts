/**
 * Deterministic policy gate (BUILD-D-011, REQ-D-024). Every consequential tool
 * call passes this gate BEFORE any effect — prompt text never grants capability.
 * It enforces the tool allowlist, workspace path containment (RULE-D-001-style),
 * and network locality. UI approval can never bypass a denied effective policy.
 */
import { isAbsolute, resolve } from "node:path";
import { checkEndpoint, type NetPolicyState } from "../security/net-policy.js";
import type { ToolDecision } from "../orchestrator/phase-runner.js";

export interface GateConfig {
  allowedTools: string[];
  workspaceRoot: string;
  netState: () => NetPolicyState;
}

/** Extract candidate path-like and url-like strings from arbitrary tool input. */
function collectStrings(input: unknown, keys: RegExp): string[] {
  const out: string[] = [];
  const walk = (v: unknown, keyMatch: boolean): void => {
    if (typeof v === "string") {
      if (keyMatch) out.push(v);
      return;
    }
    if (Array.isArray(v)) v.forEach((i) => walk(i, keyMatch));
    else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) walk(val, keys.test(k));
    }
  };
  walk(input, false);
  return out;
}

const PATH_KEYS = /(path|file|dir|directory|cwd|target|dest|destination)/i;
const URL_KEYS = /(url|uri|endpoint|host|address)/i;

export class PolicyGate {
  private readonly root: string;

  constructor(private readonly config: GateConfig) {
    this.root = resolve(config.workspaceRoot);
  }

  private pathContained(p: string): boolean {
    const abs = isAbsolute(p) ? resolve(p) : resolve(this.root, p);
    return abs === this.root || abs.startsWith(`${this.root}/`);
  }

  decide(call: { tool: string; input: unknown }): ToolDecision {
    if (!this.config.allowedTools.includes(call.tool)) {
      return { allow: false, reason: `tool "${call.tool}" is not in the phase allowlist (REQ-D-024)` };
    }
    for (const p of collectStrings(call.input, PATH_KEYS)) {
      if (!this.pathContained(p)) {
        return { allow: false, reason: `path "${p}" escapes the workspace; blocked before any effect` };
      }
    }
    for (const u of collectStrings(call.input, URL_KEYS)) {
      const d = checkEndpoint(u, this.config.netState());
      if (!d.allowed) return { allow: false, reason: d.reason };
    }
    return { allow: true, reason: "permitted by effective policy" };
  }

  /** A ToolGate function bound to this gate, for the phase runner. */
  asToolGate(): (call: { tool: string; input: unknown; callId: string }) => ToolDecision {
    return (call) => this.decide(call);
  }
}
