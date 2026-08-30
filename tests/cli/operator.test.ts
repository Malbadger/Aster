import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { runResumeCommand, runWorkflowCommand } from '../../src/cli/operator.js';
import { ScriptedPiAdapter, defaultScriptedCapabilities } from '../../src/pi-adapter/index.js';

const originalCwd = process.cwd();
afterEach(() => process.chdir(originalCwd));

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
}

describe('operator CLI surfaces', () => {
  it('writes a credential-free project-local configuration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'law-config-'));
    process.chdir(root);
    const c = capture();
    expect(await runCli(['configure'], c.io)).toBe(0);
    const body = readFileSync(join(root, '.law', 'config.json'), 'utf8');
    expect(body).toContain('claude-pro');
    expect(body).not.toMatch(/accessToken|refreshToken|apiKey/);
  });

  it('renders Pi-owned human login handoff and refuses unknown providers', async () => {
    const c = capture();
    expect(await runCli(['provider', 'login', 'claude-pro'], c.io)).toBe(0);
    expect(c.out.join('\n')).toMatch(/human-only.*Pi/is);
    const bad = capture();
    expect(await runCli(['provider', 'login', 'claude-max'], bad.io)).toBe(4);
  });

  it('validates run arguments and denies Claude Max before opening a session', async () => {
    const missing = capture();
    expect(await runCli(['run'], missing.io)).toBe(2);
    const denied = capture();
    expect(
      await runCli(
        ['run', '--provider', 'claude-pro', '--model', 'claude-opus-max', '--prompt', 'hello'],
        denied.io,
      ),
    ).toBe(4);
    expect(denied.err.join('\n')).toMatch(/Claude Max is denied/);
  });

  it('requires a separate authorization scope before remote-provider inference', async () => {
    const c = capture();
    const adapter = new ScriptedPiAdapter({ capabilities: defaultScriptedCapabilities() });
    expect(
      await runWorkflowCommand(
        ['--provider', 'chatgpt-sub', '--model', 'gpt-5', '--prompt', 'hello'],
        c.io,
        adapter,
      ),
    ).toBe(4);
    expect(c.err.join('\n')).toMatch(/explicit --allow remote-provider/);
  });

  it('refuses resume when the checkpoint does not exist', async () => {
    const c = capture();
    expect(await runCli(['resume', 'run-missing', '--model', 'qwen'], c.io)).toBe(4);
    expect(c.err.join('\n')).toMatch(/checkpoint not found/);
  });

  it('executes the operator run path end-to-end with a scripted Pi contract', async () => {
    const c = capture();
    const adapter = new ScriptedPiAdapter({ capabilities: defaultScriptedCapabilities() });
    expect(
      await runWorkflowCommand(
        ['--provider', 'ollama-local', '--model', 'qwen', '--prompt', 'hello'],
        c.io,
        adapter,
      ),
    ).toBe(0);
    expect(c.out.join('\n')).toMatch(/RUN COMPLETED.*provider=ollama.*model=qwen/);
  });
  it('records the selected provider/model and refuses a resume switch', async () => {
    const c = capture();
    const adapter = new ScriptedPiAdapter({ capabilities: defaultScriptedCapabilities() });
    expect(
      await runWorkflowCommand(
        ['--provider', 'ollama-local', '--model', 'qwen', '--prompt', 'immutable identity'],
        c.io,
        adapter,
      ),
    ).toBe(0);
    const runId = c.out.join('\n').match(/run=(run-[a-f0-9]+)/)?.[1];
    expect(runId).toBeTruthy();
    const resumed = capture();
    expect(
      await runResumeCommand([runId!, '--provider', 'chatgpt-sub', '--model', 'gpt-5'], resumed.io),
    ).toBe(4);
    expect(resumed.err.join('\n')).toMatch(/provider\/model is immutable/);
  });
});
