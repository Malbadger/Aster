import { describe, expect, it } from 'vitest';
import { RunAuthorization } from '../../src/policy/authorization.js';
import { assertInferenceEndpointAllowed, isLoopbackHost } from '../../src/policy/network.js';
import { assertConfigHasNoClaudeMax, defaultLawConfig, findProfile } from '../../src/config/profiles.js';

describe('BN-003 loopback network policy (REQ-009, UAT-008)', () => {
  it('recognizes loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('10.0.0.5')).toBe(false);
    expect(isLoopbackHost('example.com')).toBe(false);
  });

  it('allows loopback ollama endpoints, denies non-loopback', () => {
    expect(assertInferenceEndpointAllowed('ollama', 'http://127.0.0.1:11434').ok).toBe(true);
    const d = assertInferenceEndpointAllowed('ollama', 'http://10.0.0.9:11434');
    expect(d.ok).toBe(false);
    expect(d.code).toBe('NON_LOOPBACK_IN_LOCAL');
  });

  it('flags remote provider endpoints as needing authorization', () => {
    const d = assertInferenceEndpointAllowed('claude-pro', 'https://api.anthropic.com');
    expect(d.ok).toBe(false);
    expect(d.code).toBe('REMOTE_NEEDS_AUTH');
  });
});

describe('REQ-010 authorization scopes', () => {
  it('denies ungranted scope with recovery, allows granted', () => {
    const none = new RunAuthorization([]);
    const d = none.assert('remote-provider');
    expect(d.ok).toBe(false);
    expect(d.recovery).toMatch(/DATA LEAVES THIS MACHINE/);
    const granted = new RunAuthorization(['registry']);
    expect(granted.assert('registry').ok).toBe(true);
  });
});

describe('config profiles (REQ-005)', () => {
  it('default config has no Claude Max pattern and exposes the three profiles', () => {
    const cfg = defaultLawConfig();
    expect(assertConfigHasNoClaudeMax(cfg).ok).toBe(true);
    expect(findProfile(cfg, 'ollama-local')?.provider).toBe('ollama');
    expect(findProfile(cfg, 'claude-pro')?.provider).toBe('claude-pro');
  });

  it('rejects a config that allowlists a Claude Max pattern', () => {
    const cfg = defaultLawConfig();
    cfg.providerPolicies[2]!.modelPolicy.allow.push('claude-3-max');
    expect(assertConfigHasNoClaudeMax(cfg).ok).toBe(false);
  });
});
