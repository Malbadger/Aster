/**
 * Core Aster-owned domain types.
 *
 * These types are the vocabulary Aster controls. Pi's own types never leak past the
 * PiAdapter boundary (REQ-002); everything the graph, policy, and evidence layers
 * see is defined here.
 */

/** Controlled acceptance-result vocabulary (05 §Result vocabulary). */
export type LawResult =
  | 'PASS'
  | 'PASS(local:ollama)'
  | 'FAIL'
  | { blocked: string } // BLOCKED(OPEN-###)
  | { notRun: 'human-only' | 'environment' };

/** Provider identifier owned by Pi or a local adapter. Providers are extensible. */
export type ProviderId = string;

export type Locality = 'local' | 'any';

/** How a provider authenticates. Aster never handles credential values (BN-011). */
export type AuthKind = 'none' | 'subscription-oauth';

/** Run host modes (REQ-011). */
export type RunMode = 'attended-host' | 'read-only-host' | 'unattended-container';

/** Capability tier per node (CLAUDE.md §10). Kept for evidence, never branched on for provider identity. */
export type Tier = 'T0' | 'T1' | 'T2' | 'T3';

/** A provider profile selected before a run (02 ProviderProfile). */
export interface ProviderProfile {
  id: string;
  provider: ProviderId;
  /** Model policy: allow/deny globs applied case-insensitively. */
  modelPolicy: { allow: string[]; deny: string[] };
  locality: Locality;
  authKind: AuthKind;
}

/** Availability of a provider's auth — a boolean/unknown, never a credential value (BN-011). */
export type AuthAvailability = 'available' | 'absent' | 'unknown';

/** Normalized, provider-neutral session events (REQ-002). Pi events are mapped into these. */
export type LawEvent =
  | { kind: 'session_started'; sessionId: string }
  | { kind: 'assistant_message'; text: string }
  | { kind: 'tool_call'; tool: string; input: unknown; callId: string }
  | { kind: 'tool_denied'; tool: string; reason: string; callId: string }
  | { kind: 'tool_result'; tool: string; ok: boolean; summary: string; callId: string }
  | { kind: 'usage'; input: number; output: number }
  | { kind: 'agent_settled' }
  | { kind: 'error'; message: string };

/** Decision returned by a tool interceptor before a tool executes (REQ-013). */
export interface ToolDecision {
  decision: 'allow' | 'deny';
  reason: string;
}

/** A tool call presented to the interceptor. */
export interface InterceptableToolCall {
  tool: string;
  input: unknown;
  callId: string;
}

export type ToolInterceptor = (call: InterceptableToolCall) => ToolDecision | Promise<ToolDecision>;

/** Observed provider/model identity, recorded into the trace (REQ-008). */
export interface ObservedIdentity {
  provider: ProviderId;
  model: string;
  locality: Locality;
}

/** One node-boundary trace record (02 TraceEntry, CLAUDE.md §11). Secrets are redacted. */
export interface TraceEntry {
  runId: string;
  step: number;
  node: string;
  attempt: number;
  startedAt: number;
  durationS: number;
  tier?: Tier;
  locality?: Locality;
  reads: Record<string, unknown>;
  writes: Record<string, unknown>;
  toolCalls: Array<{ name: string; ok: boolean; denied?: boolean; reason?: string }>;
  usage?: { input: number; output: number };
  next: string;
  routerReason?: string;
  error?: string;
}
