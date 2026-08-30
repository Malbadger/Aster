import { describe, expect, it } from 'vitest';
import { assertModelAllowed, assertNoProviderSwitch, isClaudeMax } from '../../src/policy/provider.js';
import type { ProviderProfile } from '../../src/types.js';

const claudePro: ProviderProfile = {
  id: 'claude-pro-default',
  provider: 'claude-pro',
  modelPolicy: { allow: ['claude-*'], deny: [] },
  locality: 'any',
  authKind: 'subscription-oauth',
};

describe('RULE-002 Claude Max denial (REQ-007, EX-004)', () => {
  it.each([
    'claude-max',
    'Claude-Max',
    'CLAUDE_MAX',
    'claude-3-max',
    'claude-opus-max',
    'anthropic/claude-max-latest',
    'claudeMax',
  ])('denies %s case-insensitively', (model) => {
    expect(isClaudeMax(model)).toBe(true);
    const d = assertModelAllowed(claudePro, model);
    expect(d.ok).toBe(false);
    expect(d.code).toBe('CLAUDE_MAX_DENIED');
  });

  it('allows a normal Claude Pro model', () => {
    const d = assertModelAllowed(claudePro, 'claude-sonnet-4-5');
    expect(d.ok).toBe(true);
  });

  it('denylist and allowlist globs apply', () => {
    const profile: ProviderProfile = {
      ...claudePro,
      modelPolicy: { allow: ['claude-sonnet-*'], deny: ['*preview*'] },
    };
    expect(assertModelAllowed(profile, 'claude-sonnet-4-5').ok).toBe(true);
    expect(assertModelAllowed(profile, 'claude-opus-4-8').ok).toBe(false); // not allowlisted
    expect(assertModelAllowed(profile, 'claude-sonnet-preview').ok).toBe(false); // denylisted
  });

  it('blocks mid-run provider/model switching (REQ-008)', () => {
    const ok = assertNoProviderSwitch(
      { provider: 'ollama', model: 'llama3' },
      { provider: 'ollama', model: 'llama3' },
    );
    expect(ok.ok).toBe(true);
    const bad = assertNoProviderSwitch(
      { provider: 'ollama', model: 'llama3' },
      { provider: 'claude-pro', model: 'claude-sonnet-4-5' },
    );
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('PROVIDER_MISMATCH');
  });
});
