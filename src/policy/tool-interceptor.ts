/**
 * The composed pre-execution tool gate (REQ-013).
 *
 * Turns a run's policy context into a single ToolInterceptor that the PiAdapter applies
 * before any tool executes. It enforces, in order: tool allowlist, mutation permission,
 * path containment (RULE-001), destructive-command policy (REQ-012), and network-egress
 * authorization (REQ-010). Every denial carries a reason that lands in the trace.
 */

import type { InterceptableToolCall, ProviderId, ToolDecision, ToolInterceptor } from '../types.js';
import { relative } from 'node:path';
import type { RunAuthorization } from './authorization.js';
import { classifyCommand } from './command.js';
import { resolveWithinWorkspace } from './path.js';

export interface InterceptorPolicy {
  workspaceRoot: string;
  /** Explicit tool allowlist for this session/node. */
  tools: string[];
  allowMutation: boolean;
  allowDestructive: boolean;
  provider: ProviderId;
  authorization: RunAuthorization;
  /** Interactive approval for a destructive action (attended host only). Default: deny. */
  confirm?: (call: InterceptableToolCall) => boolean;
  /** Optional phase-specific path allowlist applied after workspace containment. */
  pathPolicy?: (relativePath: string) => { ok: boolean; reason: string };
}

const MUTATING_TOOLS = new Set(['write', 'edit']);
const PATH_TOOLS = new Set(['read', 'write', 'edit', 'ls', 'grep', 'find']);
const SHELL_TOOLS = new Set(['bash', 'powershell']);
const PATH_KEYS = ['path', 'file', 'filePath', 'file_path', 'target', 'cwd', 'dir', 'directory'];

function extractPaths(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const rec = input as Record<string, unknown>;
  const out: string[] = [];
  for (const k of PATH_KEYS) {
    const v = rec[k];
    if (typeof v === 'string' && v.length > 0) out.push(v);
  }
  return out;
}

function extractCommand(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const rec = input as Record<string, unknown>;
  for (const k of ['command', 'cmd', 'script', 'code']) {
    const v = rec[k];
    if (typeof v === 'string') return v;
  }
  return '';
}

export function makeToolInterceptor(policy: InterceptorPolicy): ToolInterceptor {
  const allow = new Set(policy.tools);
  return (call: InterceptableToolCall): ToolDecision => {
    // 1. Tool allowlist (per-node least privilege).
    if (!allow.has(call.tool)) {
      return {
        decision: 'deny',
        reason: `Tool "${call.tool}" is not in this node's allowlist [${policy.tools.join(', ')}].`,
      };
    }

    // 2. Mutation permission.
    if (MUTATING_TOOLS.has(call.tool) && !policy.allowMutation) {
      return {
        decision: 'deny',
        reason: `Tool "${call.tool}" mutates files but this run mode forbids mutation (REQ-012).`,
      };
    }

    // 3. Path containment for any tool that names a path (RULE-001).
    if (PATH_TOOLS.has(call.tool)) {
      for (const p of extractPaths(call.input)) {
        const d = resolveWithinWorkspace(policy.workspaceRoot, p);
        if (!d.ok) {
          return { decision: 'deny', reason: `Path denied for "${call.tool}": ${d.reason} [${d.code}]` };
        }
        if (policy.pathPolicy) {
          const relativePath = d.resolved
            ? relative(policy.workspaceRoot, d.resolved).replaceAll('\\', '/')
            : p;
          const phase = policy.pathPolicy(relativePath);
          if (!phase.ok)
            return { decision: 'deny', reason: `Path denied for "${call.tool}": ${phase.reason}` };
        }
      }
    }

    // 4. Shell command policy: destructive + network.
    if (SHELL_TOOLS.has(call.tool)) {
      const command = extractCommand(call.input);
      const cls = classifyCommand(command);
      if (cls.destructive) {
        if (!policy.allowDestructive) {
          return {
            decision: 'deny',
            reason: `Destructive command denied (${cls.matched.join(', ')}). Not permitted in this run mode (REQ-012).`,
          };
        }
        if (!policy.confirm?.(call)) {
          return {
            decision: 'deny',
            reason: `Destructive command requires interactive confirmation and was not approved (${cls.matched.join(', ')}).`,
          };
        }
      }
      if (cls.network) {
        const scope = cls.matched.some((m) => m.includes('install') || m.includes('git-remote'))
          ? 'registry'
          : 'remote-provider';
        const authz = policy.authorization.assert(scope);
        if (!authz.ok) {
          return {
            decision: 'deny',
            reason:
              `Network command denied (${cls.matched.join(', ')}): ${authz.reason} ${authz.recovery ?? ''}`.trim(),
          };
        }
      }
    }

    return { decision: 'allow', reason: `Tool "${call.tool}" permitted by policy.` };
  };
}
