import { describe, expect, it } from 'vitest';
import { Graph, END } from '../../src/graph/index.js';
import type { NodeContract } from '../../src/graph/index.js';

function n(name: string, reads: string[], writes: string[]): NodeContract {
  return { name, reads, writes, run: () => ({ status: 'ok', writes: {} }) };
}

describe('REQ-015 graph validation (UAT-014)', () => {
  it('accepts a valid linear graph', () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: ['task'] });
    g.addNode(n('a', ['task'], ['x'])).addNode(n('b', ['x'], ['y']));
    g.addEdge('a', 'b').addEdge('b', END);
    expect(g.validate()).toEqual([]);
  });

  it('rejects a missing entry', () => {
    const g = new Graph({ version: 'v1', entry: 'missing', inputs: [] });
    g.addNode(n('a', [], [])).addEdge('a', END);
    expect(g.validate().some((i) => i.code === 'NO_ENTRY')).toBe(true);
  });

  it('rejects an edge to a missing target', () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode(n('a', [], [])).addEdge('a', 'ghost');
    expect(g.validate().some((i) => i.code === 'MISSING_TARGET')).toBe(true);
  });

  it('rejects an unreachable node', () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode(n('a', [], [])).addNode(n('island', [], []));
    g.addEdge('a', END).addEdge('island', END);
    expect(g.validate().some((i) => i.code === 'UNREACHABLE')).toBe(true);
  });

  it('rejects a node with no outgoing edge', () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode(n('a', [], []));
    expect(g.validate().some((i) => i.code === 'NO_OUT_EDGE')).toBe(true);
  });

  it('rejects a conditional edge with no default branch', () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode(n('a', [], ['s'])).addNode(n('b', ['s'], []));
    g.addConditionalEdges('a', () => 'x', { x: 'b' }); // no default
    g.addEdge('b', END);
    expect(g.validate().some((i) => i.code === 'NO_DEFAULT_BRANCH')).toBe(true);
  });

  it('rejects an unsatisfied read', () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode(n('a', ['nope'], [])).addEdge('a', END);
    expect(g.validate().some((i) => i.code === 'UNSATISFIED_READ')).toBe(true);
  });

  it('rejects two writers on a non-reducer key', () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode(n('a', [], ['k'])).addNode(n('b', [], ['k']));
    g.addEdge('a', 'b').addEdge('b', END);
    expect(g.validate().some((i) => i.code === 'MULTIPLE_WRITERS')).toBe(true);
  });

  it('accepts two writers when a reducer is registered', () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode(n('a', [], ['k'])).addNode(n('b', [], ['k']));
    g.addReducer('k', (o, i) => [...((o as unknown[]) ?? []), i]);
    g.addEdge('a', 'b').addEdge('b', END);
    expect(g.validate().some((i) => i.code === 'MULTIPLE_WRITERS')).toBe(false);
  });

  it('rejects an uncapped cycle', () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode(n('a', [], ['s'])).addNode(n('b', ['s'], []));
    g.addEdge('a', 'b');
    g.addConditionalEdges('b', () => 'back', { back: 'a', default: END }); // no cycleCap
    expect(g.validate().some((i) => i.code === 'UNCAPPED_CYCLE')).toBe(true);
  });

  it('accepts a capped cycle', () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode(n('a', [], ['s'])).addNode(n('b', ['s'], []));
    g.addEdge('a', 'b');
    g.addConditionalEdges('b', () => 'back', { back: 'a', default: END }, { counterKey: 'loops', max: 3 });
    expect(g.validate().some((i) => i.code === 'UNCAPPED_CYCLE')).toBe(false);
  });
});
