import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { RunAuthorization } from '../../src/policy/authorization.js';
import { makeToolInterceptor, type InterceptorPolicy } from '../../src/policy/tool-interceptor.js';
import type { InterceptableToolCall } from '../../src/types.js';

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'law-int-'));
});

function call(tool: string, input: unknown): InterceptableToolCall {
  return { tool, input, callId: `${tool}-1` };
}

function policy(over: Partial<InterceptorPolicy> = {}): InterceptorPolicy {
  return {
    workspaceRoot: root,
    tools: ['read', 'write', 'edit', 'bash', 'ls'],
    allowMutation: true,
    allowDestructive: false,
    provider: 'ollama',
    authorization: new RunAuthorization([]),
    ...over,
  };
}

describe('composed tool interceptor (REQ-013)', () => {
  it('denies a tool not on the allowlist', () => {
    const i = makeToolInterceptor(policy({ tools: ['read'] }));
    expect(i(call('write', { path: 'a.txt' })).decision).toBe('deny');
  });

  it('denies mutation when the run mode forbids it', () => {
    const i = makeToolInterceptor(policy({ allowMutation: false }));
    const d = i(call('write', { path: 'a.txt' }));
    expect(d.decision).toBe('deny');
    expect(d.reason).toMatch(/mutates/);
  });

  it('allows an in-workspace write when mutation permitted', () => {
    const i = makeToolInterceptor(policy());
    expect(i(call('write', { path: 'a.txt' })).decision).toBe('allow');
  });

  it('denies a path escape (RULE-001)', () => {
    const i = makeToolInterceptor(policy());
    expect(i(call('read', { path: '/etc/passwd' })).decision).toBe('deny');
    expect(i(call('read', { path: '../../etc/passwd' })).decision).toBe('deny');
  });

  it('denies a destructive shell command when not allowed', () => {
    const i = makeToolInterceptor(policy());
    const d = i(call('bash', { command: 'rm -rf /' }));
    expect(d.decision).toBe('deny');
    expect(d.reason).toMatch(/destructive/i);
  });

  it('allows a destructive command only with explicit confirmation (attended)', () => {
    const denied = makeToolInterceptor(policy({ allowDestructive: true }));
    expect(denied(call('bash', { command: 'rm -rf build' })).decision).toBe('deny'); // no confirm
    const approved = makeToolInterceptor(policy({ allowDestructive: true, confirm: () => true }));
    expect(approved(call('bash', { command: 'rm -rf build' })).decision).toBe('allow');
  });

  it('denies network egress without the right authorization scope, allows with it', () => {
    const noAuth = makeToolInterceptor(policy());
    expect(noAuth(call('bash', { command: 'curl https://example.com' })).decision).toBe('deny');

    const withRemote = makeToolInterceptor(
      policy({ authorization: new RunAuthorization(['remote-provider']) }),
    );
    expect(withRemote(call('bash', { command: 'curl https://example.com' })).decision).toBe('allow');

    const withRegistry = makeToolInterceptor(policy({ authorization: new RunAuthorization(['registry']) }));
    expect(withRegistry(call('bash', { command: 'npm install left-pad' })).decision).toBe('allow');
  });
});
