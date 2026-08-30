/**
 * Graph executor (CLAUDE.md §§7,8,11). Runs a validated graph: budgets at each boundary,
 * typed node results, reducers, deterministic routing with capped cycles, a trace record
 * per boundary, and an atomic checkpoint after each completed node.
 */

import { createHash } from 'node:crypto';
import type { TraceEntry } from '../types.js';
import { BudgetTracker, DEFAULT_BUDGET, type Budget } from './budget.js';
import {
  type Checkpoint,
  type CheckpointHashes,
  shouldRunSideEffectNode,
  writeCheckpoint,
} from './checkpoint.js';
import { assertValid, type Graph } from './graph.js';
import { END, type NodeContract, type NodeResult, type RunState } from './types.js';

export interface RunServices {
  hashes: CheckpointHashes;
  budget?: Budget;
  /** Directory for checkpoints; when omitted, checkpoints are skipped (pure runs). */
  checkpointDir?: string;
  now?: () => number;
  onTrace?: (t: TraceEntry) => void;
}

export function contentRunId(
  workflowHash: string,
  configHash: string,
  inputs: Record<string, unknown>,
): string {
  const h = createHash('sha256').update(JSON.stringify({ workflowHash, configHash, inputs })).digest('hex');
  return `run-${h.slice(0, 16)}`;
}

function mergeWrites(
  state: RunState,
  node: NodeContract,
  writes: Record<string, unknown> | undefined,
  graph: Graph,
): void {
  if (!writes) return;
  for (const [k, v] of Object.entries(writes)) {
    const reducer = graph.getReducer(k);
    state.data[k] = reducer ? reducer(state.data[k], v) : v;
  }
}

/** Run a graph to a terminal state. Resumes from `resumeState` when provided. */
export async function runGraph(
  graph: Graph,
  initialData: Record<string, unknown>,
  services: RunServices,
  resumeState?: RunState,
): Promise<RunState> {
  assertValid(graph);
  const now = services.now ?? Date.now;
  const budget = new BudgetTracker(services.budget ?? DEFAULT_BUDGET, now());

  const workflowHash = graph.topologyHash();
  const state: RunState = resumeState ?? {
    runId: contentRunId(workflowHash, services.hashes.configHash, initialData),
    workflowHash,
    configHash: services.hashes.configHash,
    status: 'running',
    data: { ...initialData },
    results: {},
    step: 0,
    attempts: {},
    trace: [],
  };

  let current = resumeState ? nextNodeName(graph, resumeState) : graph.spec.entry;

  while (current !== END) {
    const bc = budget.check(now());
    if (!bc.ok) {
      state.status = 'exhausted';
      state.trace.push(
        boundaryTrace(state, current, 0, END, `budget:${bc.kind}`, now(), now(), { error: bc.detail }),
      );
      break;
    }

    const node = graph.getNode(current);
    if (!node) {
      state.status = 'failed';
      break;
    }

    // Idempotency gate for side-effecting nodes on resume (REQ-020).
    if (node.idempotencyKey && !shouldRunSideEffectNode(state, node.name)) {
      const next = routeFrom(graph, state, node.name);
      state.trace.push(
        boundaryTrace(
          state,
          node.name,
          state.attempts[node.name] ?? 0,
          next,
          'idempotent-skip',
          now(),
          now(),
          {},
        ),
      );
      current = next;
      continue;
    }

    const attempt = (state.attempts[node.name] ?? 0) + 1;
    state.attempts[node.name] = attempt;
    const startedAt = now();

    const reads = pickReads(state, node);
    let result: NodeResult;
    try {
      result = await node.run({ state, reads, runId: state.runId, node: node.name, attempt });
    } catch (err) {
      result = { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }

    mergeWrites(state, node, result.writes, graph);
    state.results[node.name] = result;

    const maxAttempts = node.maxAttempts ?? (services.budget ?? DEFAULT_BUDGET).defaultMaxAttempts;

    // Retryable error: stay on the same node until attempts are exhausted (REQ-021).
    if (result.status === 'error' && attempt < maxAttempts) {
      state.trace.push(
        boundaryTrace(
          state,
          node.name,
          attempt,
          node.name,
          `retry:${attempt}/${maxAttempts}`,
          startedAt,
          now(),
          { error: result.error, result },
        ),
      );
      budget.tick();
      state.step += 1;
      if (services.checkpointDir) writeStep(services, state, node.name);
      continue;
    }

    if (result.status === 'error' || result.status === 'invalid_output') {
      state.status = 'failed';
      const t = boundaryTrace(
        state,
        node.name,
        attempt,
        END,
        `terminal:${result.status}`,
        startedAt,
        now(),
        { error: result.error, result },
      );
      state.trace.push(t);
      services.onTrace?.(t);
      budget.tick();
      state.step += 1;
      if (services.checkpointDir) writeStep(services, state, END);
      break;
    }

    // Terminal node-level outcomes stop the run with a distinct status.
    if (result.status === 'exhausted' || result.status === 'blocked' || result.status === 'cancelled') {
      state.status =
        result.status === 'exhausted' ? 'exhausted' : result.status === 'blocked' ? 'blocked' : 'cancelled';
      const t = boundaryTrace(state, node.name, attempt, END, `terminal:${result.status}`, startedAt, now(), {
        result,
      });
      state.trace.push(t);
      services.onTrace?.(t);
      budget.tick();
      state.step += 1;
      if (services.checkpointDir) writeStep(services, state, END);
      break;
    }

    const next = routeFrom(graph, state, node.name);
    const t = boundaryTrace(
      state,
      node.name,
      attempt,
      next,
      routerReasonFor(graph, node.name),
      startedAt,
      now(),
      { result },
    );
    state.trace.push(t);
    services.onTrace?.(t);

    budget.tick();
    state.step += 1;
    if (services.checkpointDir) writeStep(services, state, next);
    current = next;
  }

  if (current === END && state.status === 'running') state.status = 'completed';
  return state;
}

function pickReads(state: RunState, node: NodeContract): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of node.reads) out[k] = state.data[k];
  return out;
}

function nextNodeName(graph: Graph, state: RunState): string {
  // On resume we continue from the last checkpoint's nextNode, stored as data.__nextNode.
  const n = state.data.__nextNode;
  return typeof n === 'string' ? n : graph.spec.entry;
}

function routeFrom(graph: Graph, state: RunState, from: string): string {
  const edges = graph.outEdges(from);
  const edge = edges[0];
  if (!edge) return END;
  if (edge.kind === 'static') return edge.to;
  // conditional: apply cycle cap
  if (edge.cycleCap) {
    const c = (state.data[edge.cycleCap.counterKey] as number | undefined) ?? 0;
    if (c >= edge.cycleCap.max) {
      return edge.mapping.default ?? END;
    }
  }
  const key = edge.router(state);
  const target = edge.mapping[key] ?? edge.mapping.default;
  if (edge.cycleCap && target !== (edge.mapping.default ?? END)) {
    const c = (state.data[edge.cycleCap.counterKey] as number | undefined) ?? 0;
    state.data[edge.cycleCap.counterKey] = c + 1;
  }
  return target ?? END;
}

function routerReasonFor(graph: Graph, from: string): string {
  const edge = graph.outEdges(from)[0];
  if (!edge) return 'no-edge';
  return edge.kind === 'static' ? `static->${edge.to}` : 'conditional';
}

function writeStep(services: RunServices, state: RunState, nextNode: string): void {
  state.data.__nextNode = nextNode;
  const cp: Checkpoint = {
    runId: state.runId,
    step: state.step,
    nextNode,
    state,
    hashes: services.hashes,
  };
  writeCheckpoint(services.checkpointDir as string, cp);
}

function boundaryTrace(
  state: RunState,
  node: string,
  attempt: number,
  next: string,
  routerReason: string,
  startedAt: number,
  endedAt: number,
  extra: { error?: string; result?: NodeResult },
): TraceEntry {
  const result = extra.result;
  return {
    runId: state.runId,
    step: state.step,
    node,
    attempt,
    startedAt,
    durationS: (endedAt - startedAt) / 1000,
    reads: {},
    writes: result?.writes ?? {},
    toolCalls: result?.toolCalls ?? [],
    ...(result?.usage ? { usage: result.usage } : {}),
    next,
    routerReason,
    ...(extra.error ? { error: extra.error } : {}),
  };
}
