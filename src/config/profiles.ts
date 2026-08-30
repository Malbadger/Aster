/**
 * Provider profiles and LawConfig (02 data model: LawConfig, ProviderProfile).
 *
 * A profile is chosen BEFORE a run and recorded; the provider is immutable within a run
 * (REQ-005, REQ-008). Config never contains credential values (BN-011). Claude Max is not
 * a selectable profile and is denied even if edited in (RULE-002, enforced in policy/provider).
 */

import type { AuthKind, Locality, ProviderId, ProviderProfile, RunMode } from '../types.js';

export interface ContainerPolicy {
  /** Engine LAW will require for unattended mutation; 'auto' = detect via doctor. */
  engine: 'auto' | 'docker' | 'podman';
  /** Explicit workspace mounts (host path → container path). */
  mounts: Array<{ source: string; target: string; readonly: boolean }>;
  /** Network policy inside the container. */
  network: 'none' | 'loopback' | 'explicit';
  /** Run as non-root inside the container. */
  nonRoot: boolean;
}

export interface LawConfig {
  schemaVersion: 1;
  /** Owner-promoted qualified Pi version used by production. */
  stablePi: string;
  /** Newest version currently under qualification, if any. */
  testedPi: string | null;
  providerPolicies: ProviderProfile[];
  containerPolicy: ContainerPolicy;
  /** Default run mode when not specified on the CLI. */
  defaultRunMode: RunMode;
}

/** The built-in default profiles for v1 (Ollama, ChatGPT sub, Claude Pro). */
export const DEFAULT_PROFILES: ProviderProfile[] = [
  {
    id: 'ollama-local',
    provider: 'ollama',
    modelPolicy: { allow: ['*'], deny: [] },
    locality: 'local',
    authKind: 'none',
  },
  {
    id: 'chatgpt-sub',
    provider: 'chatgpt',
    // subscription models; explicit deny of anything that looks like a denied tier
    modelPolicy: { allow: ['gpt-*', 'o1*', 'o3*', 'o4*'], deny: [] },
    locality: 'any',
    authKind: 'subscription-oauth',
  },
  {
    id: 'claude-pro',
    provider: 'claude-pro',
    // Claude Pro models; Claude Max is denied by RULE-002 regardless of this list.
    modelPolicy: { allow: ['claude-*'], deny: ['*max*'] },
    locality: 'any',
    authKind: 'subscription-oauth',
  },
];

export function defaultLawConfig(): LawConfig {
  return {
    schemaVersion: 1,
    stablePi: '0.84.4',
    testedPi: null,
    providerPolicies: DEFAULT_PROFILES,
    containerPolicy: {
      engine: 'auto',
      mounts: [],
      network: 'none',
      nonRoot: true,
    },
    defaultRunMode: 'attended-host',
  };
}

export function findProfile(config: LawConfig, id: string): ProviderProfile | undefined {
  return config.providerPolicies.find((p) => p.id === id);
}

/** Guard against a config that accidentally lists Claude Max as selectable. */
export function assertConfigHasNoClaudeMax(config: LawConfig): { ok: boolean; reason: string } {
  for (const p of config.providerPolicies) {
    for (const a of p.modelPolicy.allow) {
      if (/claude.*max/i.test(a)) {
        return {
          ok: false,
          reason: `Profile "${p.id}" allowlists a Claude Max pattern "${a}" (denied by DEC-005).`,
        };
      }
    }
  }
  return { ok: true, reason: 'No Claude Max pattern in any profile allowlist.' };
}

export type { ProviderId, Locality, AuthKind };
