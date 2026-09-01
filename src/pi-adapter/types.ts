/**
 * The single Aster-owned boundary over Pi (BN-001, REQ-002).
 *
 * Every Pi-specific operation lives behind this interface. Normal Aster code depends
 * only on these types — never on `@earendil-works/pi-*` directly. Two implementations
 * exist: `PiSdkAdapter` (real, uses Pi public exports) and `ScriptedPiAdapter`
 * (deterministic fixtures, no provider/process) so the whole graph runs without a model.
 */

import type {
  AuthAvailability,
  InterceptableToolCall,
  LawEvent,
  Locality,
  ObservedIdentity,
  ProviderId,
  ProviderProfile,
  ToolInterceptor,
} from '../types.js';
import type { CustomProviderSpec } from './custom-provider.js';

export type ContainerEngine = 'docker' | 'podman' | 'none';

/** Everything `law doctor` reports (REQ-004). Derived, never inferred. */
export interface PiCapabilities {
  runtime: { node: string; platform: string; arch: string };
  pi: {
    /** Project-local qualified Pi version, or null when missing/unreadable. */
    version: string | null;
    source: 'project-local' | 'missing';
    /** Whether the installed Pi satisfies the adapter's tested version range. */
    compatible: boolean;
    testedRange: string;
  };
  adapter: { id: string; version: string };
  providers: Array<{
    id: ProviderId;
    authKind: 'none' | 'subscription-oauth';
    authAvailable: AuthAvailability;
    locality: Locality;
    note?: string;
  }>;
  container: { engine: ContainerEngine; available: boolean; detail?: string };
  models: { registryAvailable: boolean; note?: string };
}

/** Result of validating a requested profile against policy + Pi model resolution (REQ-005/007/008). */
export interface ProviderResolution {
  ok: boolean;
  observed?: ObservedIdentity;
  reason?: string;
}

/** Spec handed to the adapter to open a bounded session (REQ-016). */
export interface SessionSpec {
  /** Provider profile chosen before the run; immutable for the session (REQ-008). */
  profile: ProviderProfile;
  /** Exact model selected and policy-checked before the run. */
  requestedModel?: string;
  /** Provider-neutral reasoning level, translated to Pi by the adapter. */
  effort?: 'minimal' | 'low' | 'medium' | 'high' | 'max';
  /** Explicit tool allowlist for this session/node (REQ-013, per-node least privilege). */
  tools: string[];
  /** Pre-execution interceptor applied to every tool call (REQ-013). */
  interceptor: ToolInterceptor;
  /** Working directory root; all file effects must resolve within it (RULE-001). */
  workspaceRoot: string;
  /** Whether the session may mutate files (false ⇒ read-only host, REQ-012). */
  allowMutation: boolean;
  /** Optional secret-free custom endpoint registered for this session. */
  customProvider?: CustomProviderSpec;
}

/** A pointer into Pi session storage — never the transcript content (REQ-017). */
export interface TranscriptRef {
  sessionId: string;
  storage: 'pi-session';
}

export interface PiSession {
  readonly sessionId: string;
  /** Submit a prompt; yields normalized, provider-neutral events (REQ-002). */
  submit(prompt: string, images?: Array<{ data: string; mimeType: string }>): AsyncIterable<LawEvent>;
  /** Structured equivalents of Pi's non-prompt slash controls. */
  control?(command: string, argument?: string): Promise<string>;
  /** A reference to where the transcript lives, not its content (REQ-017). */
  transcriptRef(): TranscriptRef;
  abort(): Promise<void>;
  dispose(): Promise<void>;
}

export interface PiAdapter {
  readonly id: string;
  readonly adapterVersion: string;
  capabilities(): Promise<PiCapabilities>;
  /** Validate a profile + requested model against policy and Pi resolution; no network. */
  resolveProvider(profile: ProviderProfile, requestedModel: string): ProviderResolution;
  openSession(spec: SessionSpec): Promise<PiSession>;
}

/** Re-export for adapter consumers. */
export type { InterceptableToolCall };
