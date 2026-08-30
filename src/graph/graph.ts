/**
 * Graph builder + static validation (REQ-015, CLAUDE.md §5).
 *
 * validate() asserts, before any Pi/tool call: entry exists; every edge target exists;
 * every node is reachable from entry; every node has an out-edge; every conditional edge
 * has a default; declared `reads` are satisfied by an upstream writer or a declared input;
 * one non-reducer writer per key; every cycle has a counter+cap.
 */

import { createHash } from 'node:crypto';
import {
  END,
  type ConditionalEdge,
  type Edge,
  type NodeContract,
  type Reducer,
  type Router,
} from './types.js';

export interface ValidationIssue {
  code:
    | 'NO_ENTRY'
    | 'DUP_NODE'
    | 'MISSING_TARGET'
    | 'UNREACHABLE'
    | 'NO_OUT_EDGE'
    | 'NO_DEFAULT_BRANCH'
    | 'UNSATISFIED_READ'
    | 'MULTIPLE_WRITERS'
    | 'UNCAPPED_CYCLE';
  detail: string;
}

export interface GraphSpec {
  version: string;
  entry: string;
  /** Keys present in the initial state.data (inputs written once at entry). */
  inputs: string[];
}

export class Graph {
  readonly spec: GraphSpec;
  private readonly nodes = new Map<string, NodeContract>();
  private readonly edges: Edge[] = [];
  private readonly reducers = new Map<string, Reducer>();

  constructor(spec: GraphSpec) {
    this.spec = spec;
  }

  addNode(node: NodeContract): this {
    if (this.nodes.has(node.name)) throw new Error(`duplicate node "${node.name}"`);
    this.nodes.set(node.name, node);
    return this;
  }

  addEdge(from: string, to: string): this {
    this.edges.push({ kind: 'static', from, to });
    return this;
  }

  addConditionalEdges(
    from: string,
    router: Router,
    mapping: Record<string, string>,
    cycleCap?: ConditionalEdge['cycleCap'],
  ): this {
    this.edges.push({ kind: 'conditional', from, router, mapping, ...(cycleCap ? { cycleCap } : {}) });
    return this;
  }

  addReducer(key: string, reducer: Reducer): this {
    this.reducers.set(key, reducer);
    return this;
  }

  getNode(name: string): NodeContract | undefined {
    return this.nodes.get(name);
  }
  getReducer(key: string): Reducer | undefined {
    return this.reducers.get(key);
  }
  outEdges(from: string): Edge[] {
    return this.edges.filter((e) => e.from === from);
  }

  /** Deterministic topology hash for checkpoint/version pinning (REQ-018/019). */
  topologyHash(): string {
    const shape = {
      version: this.spec.version,
      entry: this.spec.entry,
      inputs: [...this.spec.inputs].sort(),
      nodes: [...this.nodes.values()]
        .map((n) => ({ name: n.name, reads: [...n.reads].sort(), writes: [...n.writes].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      edges: this.edges
        .map((e) =>
          e.kind === 'static'
            ? { k: 's', from: e.from, to: e.to }
            : { k: 'c', from: e.from, mapping: e.mapping },
        )
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    };
    return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
  }

  validate(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const nodeNames = new Set(this.nodes.keys());

    if (!nodeNames.has(this.spec.entry)) {
      issues.push({ code: 'NO_ENTRY', detail: `entry "${this.spec.entry}" is not a node` });
    }

    // targets exist
    const targets = (e: Edge): string[] => (e.kind === 'static' ? [e.to] : Object.values(e.mapping));
    for (const e of this.edges) {
      for (const t of targets(e)) {
        if (t !== END && !nodeNames.has(t)) {
          issues.push({
            code: 'MISSING_TARGET',
            detail: `edge from "${e.from}" targets missing node "${t}"`,
          });
        }
      }
      if (e.kind === 'conditional' && !('default' in e.mapping)) {
        issues.push({
          code: 'NO_DEFAULT_BRANCH',
          detail: `conditional edge from "${e.from}" has no default branch`,
        });
      }
    }

    // every node has an out-edge (except END)
    for (const name of nodeNames) {
      if (this.outEdges(name).length === 0) {
        issues.push({ code: 'NO_OUT_EDGE', detail: `node "${name}" has no outgoing edge (silent hang)` });
      }
    }

    // reachability from entry
    const reachable = new Set<string>();
    const stack = [this.spec.entry];
    while (stack.length) {
      const cur = stack.pop() as string;
      if (reachable.has(cur) || cur === END) continue;
      reachable.add(cur);
      for (const e of this.outEdges(cur)) for (const t of targets(e)) stack.push(t);
    }
    for (const name of nodeNames) {
      if (!reachable.has(name))
        issues.push({ code: 'UNREACHABLE', detail: `node "${name}" is unreachable from entry` });
    }

    // one non-reducer writer per key + reads satisfied
    const writers = new Map<string, string[]>();
    for (const n of this.nodes.values()) {
      for (const w of n.writes) {
        writers.set(w, [...(writers.get(w) ?? []), n.name]);
      }
    }
    for (const [key, ws] of writers) {
      if (ws.length > 1 && !this.reducers.has(key)) {
        issues.push({
          code: 'MULTIPLE_WRITERS',
          detail: `key "${key}" written by ${ws.join(', ')} without a reducer`,
        });
      }
    }
    const producible = new Set<string>([...this.spec.inputs, ...writers.keys()]);
    for (const n of this.nodes.values()) {
      for (const r of n.reads) {
        if (!producible.has(r)) {
          issues.push({
            code: 'UNSATISFIED_READ',
            detail: `node "${n.name}" reads "${r}" which no input or upstream node writes`,
          });
        }
      }
    }

    // Cycles must be capped. A cycle is closed by a BACK-EDGE (a transition to a node
    // currently on the DFS stack). Only the back-edge must carry a conditional cycleCap;
    // forward edges in the loop are fine. This flags a→b→a when the b→a transition is
    // static or an uncapped conditional, but accepts it when b→a is a capped conditional.
    issues.push(...this.uncappedBackEdgeIssues());

    return issues;
  }

  private uncappedBackEdgeIssues(): ValidationIssue[] {
    const out: ValidationIssue[] = [];
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const transitions = (from: string): Array<{ to: string; capped: boolean }> => {
      const res: Array<{ to: string; capped: boolean }> = [];
      for (const e of this.outEdges(from)) {
        if (e.kind === 'static') res.push({ to: e.to, capped: false });
        else for (const to of Object.values(e.mapping)) res.push({ to, capped: Boolean(e.cycleCap) });
      }
      return res;
    };
    const dfs = (node: string): void => {
      visited.add(node);
      onStack.add(node);
      for (const { to, capped } of transitions(node)) {
        if (to === END) continue;
        if (onStack.has(to)) {
          if (!capped) {
            out.push({
              code: 'UNCAPPED_CYCLE',
              detail: `back-edge "${node}" -> "${to}" closes a cycle without a counter+cap`,
            });
          }
        } else if (!visited.has(to)) {
          dfs(to);
        }
      }
      onStack.delete(node);
    };
    for (const name of this.nodes.keys()) {
      if (!visited.has(name)) dfs(name);
    }
    return out;
  }
}

export function assertValid(graph: Graph): void {
  const issues = graph.validate();
  if (issues.length) {
    const msg = issues.map((i) => `[${i.code}] ${i.detail}`).join('\n');
    throw new GraphValidationError(`graph "${graph.spec.version}" is invalid:\n${msg}`, issues);
  }
}

export class GraphValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(message: string, issues: ValidationIssue[]) {
    super(message);
    this.name = 'GraphValidationError';
    this.issues = issues;
  }
}
