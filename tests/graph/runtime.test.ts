import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Graph,
  END,
  runGraph,
  readLatestCheckpoint,
  assertResumable,
  type CheckpointHashes,
  type NodeContract,
  type RunServices,
} from '../../src/graph/index.js';

const hashes: CheckpointHashes = {
  workflowHash: 'wf',
  configHash: 'cfg',
  adapterVersion: '0.1.0',
  piVersion: '0.84.4',
};

function services(over: Partial<RunServices> = {}): RunServices {
  return { hashes, ...over };
}

describe('graph executor (REQ-021, UAT-020) budgets + typed outcomes', () => {
  it('runs a linear graph to completion and threads state', async () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: ['n'] });
    g.addNode({
      name: 'a',
      reads: ['n'],
      writes: ['x'],
      run: (c) => ({ status: 'ok', writes: { x: (c.reads.n as number) + 1 } }),
    });
    g.addNode({
      name: 'b',
      reads: ['x'],
      writes: ['y'],
      run: (c) => ({ status: 'ok', writes: { y: (c.reads.x as number) * 2 } }),
    });
    g.addEdge('a', 'b').addEdge('b', END);
    const s = await runGraph(g, { n: 1 }, services());
    expect(s.status).toBe('completed');
    expect(s.data.x).toBe(2);
    expect(s.data.y).toBe(4);
    expect(s.trace.length).toBe(2);
  });

  it('stops at max steps with a distinct exhausted status', async () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode({
      name: 'a',
      reads: [],
      writes: ['c'],
      run: (c) => ({ status: 'ok', writes: { c: ((c.reads.c as number) ?? 0) + 1 } }),
    });
    // self-loop capped high so budget (not cycle cap) trips first
    g.addConditionalEdges('a', () => 'again', { again: 'a', default: END }, { counterKey: 'k', max: 1000 });
    const s = await runGraph(
      g,
      {},
      services({ budget: { maxSteps: 5, deadlineMs: 60_000, defaultMaxAttempts: 1 } }),
    );
    expect(s.status).toBe('exhausted');
    expect(s.trace.some((t) => t.routerReason === 'budget:steps')).toBe(true);
  });

  it('routes conditionally and honors a cycle cap', async () => {
    const g = new Graph({ version: 'v1', entry: 'inc', inputs: [] });
    g.addNode({
      name: 'inc',
      reads: [],
      writes: ['count'],
      run: (c) => ({ status: 'ok', writes: { count: ((c.reads.count as number) ?? 0) + 1 } }),
    });
    g.addNode({ name: 'done', reads: ['count'], writes: [], run: () => ({ status: 'ok', writes: {} }) });
    g.addConditionalEdges(
      'inc',
      () => 'loop',
      { loop: 'inc', default: 'done' },
      { counterKey: 'loops', max: 3 },
    );
    g.addEdge('done', END);
    const s = await runGraph(g, {}, services());
    expect(s.status).toBe('completed');
    expect(s.data.loops).toBe(3); // looped exactly the cap, then defaulted to done
  });

  it('propagates a terminal blocked outcome', async () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode({ name: 'a', reads: [], writes: [], run: () => ({ status: 'blocked', error: 'policy' }) });
    g.addEdge('a', END);
    const s = await runGraph(g, {}, services());
    expect(s.status).toBe('blocked');
  });

  it('does not report a node error as a completed graph', async () => {
    const g = new Graph({ version: 'v1', entry: 'a', inputs: [] });
    g.addNode({ name: 'a', reads: [], writes: [], run: () => ({ status: 'error', error: 'provider failed' }) });
    g.addEdge('a', END);
    const s = await runGraph(g, {}, services());
    expect(s.status).toBe('failed');
    expect(s.trace.at(-1)?.routerReason).toBe('terminal:error');
  });
});

describe('REQ-018/019 checkpoint + resume', () => {
  it('writes atomic checkpoints and refuses resume on hash mismatch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'law-ckpt-'));
    const g = new Graph({ version: 'v1', entry: 'a', inputs: ['n'] });
    g.addNode({
      name: 'a',
      reads: ['n'],
      writes: ['x'],
      run: (c) => ({ status: 'ok', writes: { x: c.reads.n } }),
    });
    g.addNode({
      name: 'b',
      reads: ['x'],
      writes: ['y'],
      run: (c) => ({ status: 'ok', writes: { y: c.reads.x } }),
    });
    g.addEdge('a', 'b').addEdge('b', END);
    const s = await runGraph(g, { n: 7 }, services({ checkpointDir: dir }));
    const files = readdirSync(join(dir, s.runId)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);

    const cp = readLatestCheckpoint(dir, s.runId);
    expect(cp).not.toBeNull();
    if (cp) {
      expect(assertResumable(cp, hashes).ok).toBe(true);
      const bad = assertResumable(cp, { ...hashes, piVersion: '0.85.0' });
      expect(bad.ok).toBe(false);
      expect(bad.mismatches[0]).toMatch(/piVersion/);
    }
  });

  it('gates a side-effecting node on resume (idempotency, REQ-020)', async () => {
    let effects = 0;
    const g = new Graph({ version: 'v1', entry: 'append', inputs: [] });
    g.addNode({
      name: 'append',
      reads: [],
      writes: ['count'],
      idempotencyKey: 'append',
      run: () => {
        effects += 1;
        return { status: 'ok', writes: { count: 1 }, sideEffect: true };
      },
    });
    g.addEdge('append', END);
    const first = await runGraph(g, {}, services());
    expect(effects).toBe(1);
    // resume from the completed state: the side-effect node must be skipped
    first.data.__nextNode = 'append';
    first.status = 'running';
    await runGraph(g, {}, services(), first);
    expect(effects).toBe(1); // not re-run
  });
});
