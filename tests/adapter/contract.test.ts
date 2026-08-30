import { describe, expect, it } from 'vitest';
import { ScriptedPiAdapter, defaultScriptedCapabilities } from '../../src/pi-adapter/index.js';
import type { SessionSpec } from '../../src/pi-adapter/index.js';
import type { LawEvent, ProviderProfile, ToolInterceptor } from '../../src/types.js';

const ollamaProfile: ProviderProfile = {
  id: 'ollama-default',
  provider: 'ollama',
  modelPolicy: { allow: ['llama3', 'qwen*'], deny: [] },
  locality: 'local',
  authKind: 'none',
};

function collect(adapter: ScriptedPiAdapter, spec: SessionSpec, prompt: string): Promise<LawEvent[]> {
  return (async () => {
    const session = await adapter.openSession(spec);
    const events: LawEvent[] = [];
    for await (const e of session.submit(prompt)) events.push(e);
    return events;
  })();
}

describe('PiAdapter contract via ScriptedPiAdapter (REQ-002, UAT-002)', () => {
  it('capabilities returns the normalized contract', async () => {
    const a = new ScriptedPiAdapter({ capabilities: defaultScriptedCapabilities() });
    const caps = await a.capabilities();
    expect(caps.pi.version).toBe('0.84.4');
    expect(caps.providers.map((p) => p.id)).toEqual(['ollama', 'chatgpt', 'claude-pro']);
  });

  it('resolveProvider allows policy-permitted models and denies Claude Max', () => {
    const a = new ScriptedPiAdapter({ capabilities: defaultScriptedCapabilities() });
    expect(a.resolveProvider(ollamaProfile, 'llama3').ok).toBe(true);
    const claude: ProviderProfile = {
      ...ollamaProfile,
      provider: 'claude-pro',
      modelPolicy: { allow: ['*'], deny: [] },
    };
    const denied = a.resolveProvider(claude, 'claude-max');
    expect(denied.ok).toBe(false);
  });

  it('normalizes a session into provider-neutral events and honors an allow interceptor', async () => {
    const allowAll: ToolInterceptor = () => ({ decision: 'allow', reason: 'ok' });
    const a = new ScriptedPiAdapter({
      capabilities: defaultScriptedCapabilities(),
      plan: () => ({
        steps: [
          { t: 'say', text: 'working' },
          { t: 'tool', tool: 'read', input: { path: 'a.txt' }, okSummary: 'read a.txt' },
          { t: 'usage', input: 10, output: 5 },
        ],
      }),
    });
    const spec: SessionSpec = {
      profile: ollamaProfile,
      tools: ['read'],
      interceptor: allowAll,
      workspaceRoot: '/tmp/ws',
      allowMutation: false,
    };
    const events = await collect(a, spec, 'do it');
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual([
      'session_started',
      'assistant_message',
      'tool_call',
      'tool_result',
      'usage',
      'agent_settled',
    ]);
  });

  it('a deny interceptor blocks the tool before execution (REQ-013 gate)', async () => {
    const denyWrites: ToolInterceptor = (call) =>
      call.tool === 'write'
        ? { decision: 'deny', reason: 'writes denied in read-only mode' }
        : { decision: 'allow', reason: 'ok' };
    const a = new ScriptedPiAdapter({
      capabilities: defaultScriptedCapabilities(),
      plan: () => ({
        steps: [
          { t: 'tool', tool: 'write', input: { path: 'x' }, okSummary: 'should never run' },
          { t: 'tool', tool: 'read', input: { path: 'x' }, okSummary: 'read ok' },
        ],
      }),
    });
    const spec: SessionSpec = {
      profile: ollamaProfile,
      tools: ['read', 'write'],
      interceptor: denyWrites,
      workspaceRoot: '/tmp/ws',
      allowMutation: false,
    };
    const events = await collect(a, spec, 'try write then read');
    const denied = events.find((e) => e.kind === 'tool_denied');
    expect(denied).toBeDefined();
    // the denied write must NOT produce a tool_result
    const writeResult = events.find((e) => e.kind === 'tool_result' && e.tool === 'write');
    expect(writeResult).toBeUndefined();
    // the allowed read must produce a result
    expect(events.some((e) => e.kind === 'tool_result' && e.tool === 'read')).toBe(true);
  });

  it('transcriptRef points to Pi session storage, not content (REQ-017)', async () => {
    const a = new ScriptedPiAdapter({ capabilities: defaultScriptedCapabilities() });
    const spec: SessionSpec = {
      profile: ollamaProfile,
      tools: [],
      interceptor: () => ({ decision: 'allow', reason: 'ok' }),
      workspaceRoot: '/tmp/ws',
      allowMutation: false,
    };
    const session = await a.openSession(spec);
    const ref = session.transcriptRef();
    expect(ref.storage).toBe('pi-session');
    expect(ref.sessionId).toBe(session.sessionId);
  });
});
