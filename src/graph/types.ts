/**
 * Graph primitives (CLAUDE.md §2 "five primitives"; 02 Workflow/NodeContract).
 *
 * A workflow is a validated graph of nodes; nodes act, edges decide. Nodes never choose
 * the next node (that's smuggling control flow into data) — a router reads state and names
 * the next node. State is one typed, JSON-serializable object threaded through the run.
 */

import type { Locality, Tier, TraceEntry } from '../types.js';

export const END = '__end__' as const;
export type EndMarker = typeof END;

/** JSON-serializable run state (02 RunState). Control fields are the runtime's. */
export interface RunState {
  runId: string;
  workflowHash: string;
  configHash: string;
  status: 'running' | 'completed' | 'failed' | 'exhausted' | 'blocked' | 'cancelled';
  /** Node-written data keys (one writer per key unless a reducer is registered). */
  data: Record<string, unknown>;
  /** Per-node structured results (used for idempotency + evidence). */
  results: Record<string, NodeResult>;
  step: number;
  attempts: Record<string, number>;
  trace: TraceEntry[];
}

/** A node's structured outcome. Never a transcript (REQ-017). */
export interface NodeResult {
  status: 'ok' | 'error' | 'invalid_output' | 'exhausted' | 'cancelled' | 'blocked';
  /** Partial data update to merge into state.data. */
  writes?: Record<string, unknown>;
  /** Small structured summary for the parent/router. */
  summary?: unknown;
  error?: string;
  usage?: { input: number; output: number };
  toolCalls?: Array<{ name: string; ok: boolean; denied?: boolean; reason?: string }>;
  /** True when this node caused an external side effect (gated on resume, REQ-020). */
  sideEffect?: boolean;
}

export interface NodeRunContext {
  state: Readonly<RunState>;
  /** Read slice: only the keys this node declared in `reads`. */
  reads: Record<string, unknown>;
  runId: string;
  node: string;
  attempt: number;
}

export interface NodeContract {
  name: string;
  reads: string[];
  writes: string[];
  tools?: string[];
  tier?: Tier;
  locality?: Locality;
  maxAttempts?: number;
  /** Marks a node whose result must be gated on resume (side-effecting). */
  idempotencyKey?: string;
  run(ctx: NodeRunContext): Promise<NodeResult> | NodeResult;
}

export type Router = (state: Readonly<RunState>) => string;

export interface StaticEdge {
  kind: 'static';
  from: string;
  to: string;
}
export interface ConditionalEdge {
  kind: 'conditional';
  from: string;
  router: Router;
  /** branch key → node name; MUST include a `default` (CLAUDE.md §5). */
  mapping: Record<string, string>;
  /** capped cycle guard: max times this edge may be taken back to a prior node. */
  cycleCap?: { counterKey: string; max: number };
}
export type Edge = StaticEdge | ConditionalEdge;

export type Reducer = (previous: unknown, incoming: unknown) => unknown;
