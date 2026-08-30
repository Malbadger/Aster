import { describe, expect, it } from 'vitest';
import {
  Graph,
  END,
  makePiSessionNode,
  runGraph,
  type CheckpointHashes,
  type PiSessionSummary,
} from '../../src/graph/index.js';
import { ScriptedPiAdapter, defaultScriptedCapabilities } from '../../src/pi-adapter/index.js';
import { RunAuthorization } from '../../src/policy/authorization.js';
import type { ProviderProfile } from '../../src/types.js';

const hashes: CheckpointHashes = {
  workflowHash: 'wf',
  configHash: 'cfg',
  adapterVersion: '0.1.0',
  piVersion: '0.84.4',
};
const ollama: ProviderProfile = {
  id: 'ollama',
  provider: 'ollama',
  modelPolicy: { allow: ['*'], deny: [] },
  locality: 'local',
  authKind: 'none',
};

describe('REQ-016/017 bounded Pi session node', () => {
  it('produces a structured summary and keeps only a transcript REFERENCE in parent state', async () => {
    const adapter = new ScriptedPiAdapter({
      capabilities: defaultScriptedCapabilities(),
      plan: () => ({
        steps: [
          { t: 'say', text: 'done reasoning' },
          { t: 'tool', tool: 'read', input: { path: 'a.txt' }, okSummary: 'ok' },
          { t: 'usage', input: 100, output: 20 },
        ],
      }),
    });
    const node = makePiSessionNode({
      name: 'work',
      reads: ['task'],
      writes: ['work_result'],
      tools: ['read'],
      adapter,
      profile: ollama,
      workspaceRoot: '/tmp',
      allowMutation: false,
      authorization: new RunAuthorization([]),
      brief: (r) => `Task: ${String(r.task)}`,
      resultKey: 'work_result',
    });
    const g = new Graph({ version: 'v1', entry: 'work', inputs: ['task'] });
    g.addNode(node).addEdge('work', END);
    const s = await runGraph(g, { task: 'read the file' }, { hashes });
    const summary = s.data.work_result as PiSessionSummary;
    expect(summary.status).toBe('done');
    expect(summary.toolCallCount).toBe(1);
    expect(summary.transcript).toEqual({ sessionId: expect.any(String), storage: 'pi-session' });
    // REQ-017: shared state holds only the structured summary + a transcript REFERENCE,
    // never an event/transcript array. The assistant text is summarized in .text.
    expect(summary.text).toContain('done reasoning');
    const stored = s.data.work_result as Record<string, unknown>;
    expect(Array.isArray(stored.transcriptEntries)).toBe(false);
    expect(Array.isArray(stored.events)).toBe(false);
    expect(stored.transcript).toHaveProperty('storage', 'pi-session');
  });

  it('stops at the iteration ceiling with a distinct exhausted outcome (EX-006)', async () => {
    const adapter = new ScriptedPiAdapter({
      capabilities: defaultScriptedCapabilities(),
      plan: () => ({
        steps: [
          { t: 'tool', tool: 'read', input: { path: 'a' }, okSummary: 'ok' },
          { t: 'tool', tool: 'read', input: { path: 'b' }, okSummary: 'ok' },
          { t: 'tool', tool: 'read', input: { path: 'c' }, okSummary: 'ok' },
          { t: 'tool', tool: 'read', input: { path: 'd' }, okSummary: 'ok' },
        ],
      }),
    });
    const node = makePiSessionNode({
      name: 'loop',
      reads: ['task'],
      writes: ['r'],
      tools: ['read'],
      adapter,
      profile: ollama,
      workspaceRoot: '/tmp',
      allowMutation: false,
      brief: () => 'keep going',
      resultKey: 'r',
      budget: { maxIterations: 2, maxTokens: 1_000_000 },
    });
    const g = new Graph({ version: 'v1', entry: 'loop', inputs: ['task'] });
    g.addNode(node).addEdge('loop', END);
    const s = await runGraph(g, { task: 'x' }, { hashes });
    expect(s.status).toBe('exhausted');
    expect((s.data.r as PiSessionSummary).status).toBe('exhausted');
  });

  it('flags invalid_output when the summary fails validation', async () => {
    const adapter = new ScriptedPiAdapter({
      capabilities: defaultScriptedCapabilities(),
      plan: () => ({ steps: [{ t: 'say', text: 'nope' }] }),
    });
    const node = makePiSessionNode({
      name: 'w',
      reads: ['task'],
      writes: ['r'],
      tools: [],
      adapter,
      profile: ollama,
      workspaceRoot: '/tmp',
      allowMutation: false,
      brief: () => 'do',
      resultKey: 'r',
      validateSummary: (sum) => sum.text.includes('SUCCESS'),
    });
    const g = new Graph({ version: 'v1', entry: 'w', inputs: ['task'] });
    g.addNode(node).addEdge('w', END);
    const s = await runGraph(g, { task: 'x' }, { hashes });
    expect((s.data.r as PiSessionSummary).status).toBe('invalid_output');
  });

  it('the node interceptor denies out-of-allowlist tools (per-node least privilege)', async () => {
    const adapter = new ScriptedPiAdapter({
      capabilities: defaultScriptedCapabilities(),
      plan: () => ({
        steps: [
          { t: 'tool', tool: 'write', input: { path: 'a' }, okSummary: 'ok' }, // not in allowlist
          { t: 'tool', tool: 'read', input: { path: 'a' }, okSummary: 'ok' },
        ],
      }),
    });
    const node = makePiSessionNode({
      name: 'w',
      reads: ['task'],
      writes: ['r'],
      tools: ['read'], // write NOT allowed
      adapter,
      profile: ollama,
      workspaceRoot: '/tmp',
      allowMutation: true,
      brief: () => 'do',
      resultKey: 'r',
    });
    const g = new Graph({ version: 'v1', entry: 'w', inputs: ['task'] });
    g.addNode(node).addEdge('w', END);
    const s = await runGraph(g, { task: 'x' }, { hashes });
    const sum = s.data.r as PiSessionSummary;
    expect(sum.deniedCount).toBe(1);
  });
});
