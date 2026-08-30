/**
 * ScriptedPiAdapter — deterministic PiAdapter with no provider and no Pi process.
 *
 * This is the workhorse for tests, graph runs, and exemplars EX-001..009: it lets the
 * ENTIRE graph, policy, and evidence stack run reproducibly with zero network
 * (BUILD-record §"scripted PiAdapter fixtures so the full graph runs without a provider").
 *
 * It honors the same PiAdapter contract as the live adapter, and — critically — applies
 * the caller's ToolInterceptor to every scripted tool call, so denial/allow behavior is
 * exercised identically to production.
 */

import type { ObservedIdentity, LawEvent, ProviderProfile } from '../types.js';
import { assertModelAllowed } from '../policy/provider.js';
import type {
  PiAdapter,
  PiCapabilities,
  PiSession,
  ProviderResolution,
  SessionSpec,
  TranscriptRef,
} from './types.js';

export type ScriptedStep =
  | { t: 'say'; text: string }
  | { t: 'tool'; tool: string; input: unknown; okSummary: string; failSummary?: string }
  | { t: 'usage'; input: number; output: number };

export interface ScriptedSessionPlan {
  steps: ScriptedStep[];
}

export interface ScriptedConfig {
  id?: string;
  capabilities: PiCapabilities;
  /** Per-prompt behavior. Defaults to a single assistant reply + settle. */
  plan?: (prompt: string, spec: SessionSpec) => ScriptedSessionPlan;
  /** Override provider resolution. Defaults to policy-based resolution. */
  resolve?: (profile: ProviderProfile, model: string) => ProviderResolution;
  /** Observed model reported for resolution when policy allows. */
  observedModelFor?: (profile: ProviderProfile, model: string) => string;
}

export function defaultScriptedCapabilities(overrides: Partial<PiCapabilities> = {}): PiCapabilities {
  const base: PiCapabilities = {
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    pi: { version: '0.84.4', source: 'project-local', compatible: true, testedRange: '0.84.4' },
    adapter: { id: 'scripted', version: '0.1.0' },
    providers: [
      {
        id: 'ollama',
        authKind: 'none',
        authAvailable: 'available',
        locality: 'local',
        note: 'loopback only',
      },
      {
        id: 'chatgpt',
        authKind: 'subscription-oauth',
        authAvailable: 'unknown',
        locality: 'any',
        note: 'Pi-owned login',
      },
      {
        id: 'claude-pro',
        authKind: 'subscription-oauth',
        authAvailable: 'unknown',
        locality: 'any',
        note: 'Claude Pro; Claude Max denied',
      },
    ],
    container: { engine: 'none', available: false },
    models: { registryAvailable: true },
  };
  return { ...base, ...overrides };
}

let scriptedCounter = 0;

export class ScriptedPiAdapter implements PiAdapter {
  readonly id: string;
  readonly adapterVersion = '0.1.0';
  private readonly cfg: ScriptedConfig;

  constructor(cfg: ScriptedConfig) {
    this.cfg = cfg;
    this.id = cfg.id ?? 'scripted';
  }

  capabilities(): Promise<PiCapabilities> {
    return Promise.resolve(this.cfg.capabilities);
  }

  resolveProvider(profile: ProviderProfile, requestedModel: string): ProviderResolution {
    if (this.cfg.resolve) return this.cfg.resolve(profile, requestedModel);
    const decision = assertModelAllowed(profile, requestedModel);
    if (!decision.ok) return { ok: false, reason: decision.reason };
    const observed: ObservedIdentity = {
      provider: profile.provider,
      model: this.cfg.observedModelFor?.(profile, requestedModel) ?? requestedModel,
      locality: profile.locality,
    };
    return { ok: true, observed };
  }

  openSession(spec: SessionSpec): Promise<PiSession> {
    const sessionId = `scripted-${++scriptedCounter}`;
    const plan = this.cfg.plan ?? ((p: string) => ({ steps: [{ t: 'say', text: `ack: ${p}` }] }));
    return Promise.resolve(new ScriptedSession(sessionId, spec, plan));
  }
}

class ScriptedSession implements PiSession {
  readonly sessionId: string;
  private readonly spec: SessionSpec;
  private readonly plan: (prompt: string, spec: SessionSpec) => ScriptedSessionPlan;
  private aborted = false;

  constructor(
    sessionId: string,
    spec: SessionSpec,
    plan: (prompt: string, spec: SessionSpec) => ScriptedSessionPlan,
  ) {
    this.sessionId = sessionId;
    this.spec = spec;
    this.plan = plan;
  }

  async *submit(prompt: string): AsyncIterable<LawEvent> {
    yield { kind: 'session_started', sessionId: this.sessionId };
    const plan = this.plan(prompt, this.spec);
    let callSeq = 0;
    for (const step of plan.steps) {
      if (this.aborted) {
        yield { kind: 'error', message: 'aborted' };
        return;
      }
      if (step.t === 'say') {
        yield { kind: 'assistant_message', text: step.text };
      } else if (step.t === 'usage') {
        yield { kind: 'usage', input: step.input, output: step.output };
      } else {
        const callId = `${this.sessionId}-tc-${++callSeq}`;
        const decision = this.spec.interceptor({ tool: step.tool, input: step.input, callId });
        if (decision.decision === 'deny') {
          yield { kind: 'tool_denied', tool: step.tool, reason: decision.reason, callId };
          continue;
        }
        yield { kind: 'tool_call', tool: step.tool, input: step.input, callId };
        yield { kind: 'tool_result', tool: step.tool, ok: true, summary: step.okSummary, callId };
      }
    }
    yield { kind: 'agent_settled' };
  }

  transcriptRef(): TranscriptRef {
    return { sessionId: this.sessionId, storage: 'pi-session' };
  }

  abort(): Promise<void> {
    this.aborted = true;
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
