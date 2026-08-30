import { describe, expect, it } from 'vitest';
import {
  Graph,
  END,
  makeVerifyNode,
  runGraph,
  verificationRouter,
  type CheckpointHashes,
} from '../../src/graph/index.js';

const hashes: CheckpointHashes = {
  workflowHash: 'wf',
  configHash: 'cfg',
  adapterVersion: '0.1.0',
  piVersion: '0.84.4',
};

describe('REQ-022 deterministic verification + routing (RULE-004, UAT-021)', () => {
  it('is ready only when all required checks pass; routes to done', async () => {
    const verify = makeVerifyNode({
      name: 'verify',
      reads: ['built'],
      resultKey: 'verification',
      checks: [
        { name: 'compiles', required: true, run: (d) => ({ pass: d.built === true, detail: 'tsc' }) },
        { name: 'lint', required: false, run: () => ({ pass: true, detail: 'biome' }) },
      ],
    });
    const g = new Graph({ version: 'v1', entry: 'verify', inputs: ['built'] });
    g.addNode(verify);
    g.addNode({
      name: 'done',
      reads: ['verification'],
      writes: [],
      run: () => ({ status: 'ok', writes: {} }),
    });
    g.addNode({
      name: 'repair',
      reads: ['verification'],
      writes: [],
      run: () => ({ status: 'ok', writes: {} }),
    });
    g.addConditionalEdges('verify', verificationRouter('verification'), {
      ready: 'done',
      repair: 'repair',
      default: 'repair',
    });
    g.addEdge('done', END).addEdge('repair', END);

    const ok = await runGraph(g, { built: true }, { hashes });
    expect(ok.trace.find((t) => t.node === 'verify')?.next).toBe('done');

    const bad = await runGraph(g, { built: false }, { hashes });
    expect(bad.trace.find((t) => t.node === 'verify')?.next).toBe('repair');
  });
});
