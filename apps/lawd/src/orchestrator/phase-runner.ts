/**
 * Phase runner port. A phase is a bounded LAW/Pi node: given a locked identity
 * and a prompt, it yields provider-neutral events. The real implementation binds
 * to LAW Core's PiAdapter (`openSession().submit()`), applying the tool gate as
 * the pre-execution interceptor; the scripted implementation yields canned
 * events for deterministic tests (no provider, no process).
 */
import type { PhaseIdentity } from "@law/contracts";

export type PhaseEvent =
  | { kind: "assistant"; text: string }
  | { kind: "tool_call"; tool: string; input: unknown; callId: string }
  | { kind: "tool_result"; tool: string; ok: boolean; summary: string; callId: string }
  | { kind: "tool_denied"; tool: string; reason: string; callId: string }
  | { kind: "usage"; input: number; output: number }
  | { kind: "settled" }
  | { kind: "error"; message: string };

export interface ToolDecision {
  allow: boolean;
  reason: string;
}

/** Pre-execution gate applied to every tool call (policy lives in the daemon). */
export type ToolGate = (call: { tool: string; input: unknown; callId: string }) => ToolDecision;

export interface PhaseRunRequest {
  /** Stable chat identity; one Pi session is retained per task. */
  taskId: string;
  identity: PhaseIdentity;
  prompt: string;
  tools: string[];
  workspaceRoot: string;
  allowMutation: boolean;
  gate: ToolGate;
  /** Aborts the run; the runner should stop and let the orchestrator mark cancelled. */
  signal: AbortSignal;
}

export interface PhaseRunner {
  run(req: PhaseRunRequest): AsyncIterable<PhaseEvent>;
}
