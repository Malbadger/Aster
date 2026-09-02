/**
 * PiSdkAdapter — the real adapter over Pi's public in-process SDK.
 *
 * Boundary discipline: this file imports ONLY the public `.` entry of
 * `@earendil-works/pi-coding-agent` (import-guard enforced). Sibling `@earendil-works/pi-*`
 * packages and any `dist/**` path are forbidden.
 *
 * Testability split:
 *  - `capabilities()` and `resolveProvider()` need no provider and are unit-tested.
 *  - `openSession()` drives a live Pi session (real model + Pi-owned auth). It is wired
 *    against Pi's shipped types and type-checked at build time; an end-to-end live run
 *    requires a provider/login and is therefore human-only (UAT rows NOT-RUN(human-only)
 *    until the operator authenticates). Deterministic behavior is covered by ScriptedPiAdapter.
 */

import {
  VERSION,
  ModelRuntime,
  ModelRegistry,
  DefaultResourceLoader,
  SettingsManager,
  SessionManager,
  getAgentDir,
  createAgentSession,
  resolveCliModel,
} from '@earendil-works/pi-coding-agent';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { LawEvent, ProviderId, ProviderProfile } from '../types.js';
import { assertModelAllowed } from '../policy/provider.js';
import { makeInterceptionExtension } from './interception-extension.js';
import { detectContainerEngine, ollamaLoopbackReachable } from './probes.js';
import type {
  PiAdapter,
  PiCapabilities,
  PiSession,
  ProviderResolution,
  SessionSpec,
  TranscriptRef,
} from './types.js';
import { registerCustomProviders } from './custom-provider.js';

const TESTED_RANGE = '0.84.4';

/** Preserve Pi-native provider IDs while accepting legacy Aster aliases. */
function piProviderId(p: ProviderId): string {
  if (p === 'chatgpt') return 'openai-codex';
  if (p === 'claude-pro') return 'anthropic';
  return p;
}

export class PiSdkAdapter implements PiAdapter {
  readonly id = 'pi-sdk';
  readonly adapterVersion = '0.1.0';

  async capabilities(): Promise<PiCapabilities> {
    const piVersion = typeof VERSION === 'string' ? VERSION : null;
    const container = await detectContainerEngine();
    const ollamaUp = await ollamaLoopbackReachable();
    return {
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      pi: {
        version: piVersion,
        source: piVersion ? 'project-local' : 'missing',
        compatible: piVersion === TESTED_RANGE,
        testedRange: TESTED_RANGE,
      },
      adapter: { id: this.id, version: this.adapterVersion },
      providers: [
        {
          id: 'ollama',
          authKind: 'none',
          authAvailable: ollamaUp ? 'available' : 'absent',
          locality: 'local',
          note: ollamaUp ? 'loopback 127.0.0.1:11434 reachable' : 'ollama loopback not reachable',
        },
        {
          id: 'chatgpt',
          authKind: 'subscription-oauth',
          authAvailable: 'unknown',
          locality: 'any',
          note: 'auth owned by Pi; login via `law provider login chatgpt` (human-only)',
        },
        {
          id: 'claude-pro',
          authKind: 'subscription-oauth',
          authAvailable: 'unknown',
          locality: 'any',
          note: 'Claude Pro supported; Claude Max denied. Auth owned by Pi; extra usage requires operator approval.',
        },
      ],
      container: {
        engine: container.engine,
        available: container.available,
        ...(container.detail ? { detail: container.detail } : {}),
      },
      models: {
        registryAvailable: typeof ModelRegistry === 'function',
        note: 'Pi ModelRegistry present',
      },
    };
  }

  resolveProvider(profile: ProviderProfile, requestedModel: string): ProviderResolution {
    const decision = assertModelAllowed(profile, requestedModel);
    if (!decision.ok) return { ok: false, reason: decision.reason };
    return {
      ok: true,
      observed: { provider: profile.provider, model: requestedModel, locality: profile.locality },
    };
  }

  async openSession(spec: SessionSpec): Promise<PiSession> {
    // Pi owns credentials; Aster never reads values. allowModelNetwork stays false so that
    // Ollama runs stay loopback-only and no catalog fetch happens implicitly (BN-003).
    const runtime = await ModelRuntime.create({ allowModelNetwork: false });
    if (spec.customProvider) registerCustomProviders(runtime, [spec.customProvider]);
    if (spec.profile.provider === 'ollama') {
      // Pi has no built-in Ollama provider. Register only the exact, policy-approved model
      // for this session against Ollama's OpenAI-compatible loopback endpoint. No catalog
      // lookup or non-loopback URL is accepted here.
      const model = modelPatternOf(spec);
      runtime.registerProvider('ollama', {
        name: 'Ollama (local Aster)',
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: 'ollama-local',
        api: 'openai-completions',
        authHeader: false,
        models: [
          {
            id: model,
            name: model,
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 32_768,
            maxTokens: 8_192,
            compat: {
              supportsStore: false,
              supportsDeveloperRole: false,
              supportsReasoningEffort: false,
              supportsUsageInStreaming: true,
              supportsStrictMode: false,
            },
          },
        ],
      });
    }
    const resolved = resolveCliModel({
      cliProvider: piProviderId(spec.profile.provider),
      cliModel: modelPatternOf(spec),
      modelRuntime: runtime,
    });
    if (resolved.error || !resolved.model) {
      throw new Error(`Pi could not resolve model for ${spec.profile.id}: ${resolved.error ?? 'no model'}`);
    }

    const settingsManager = SettingsManager.create(spec.workspaceRoot, getAgentDir());
    const deniedSink: Array<{ tool: string; callId: string; reason: string }> = [];
    const loader = new DefaultResourceLoader({
      cwd: spec.workspaceRoot,
      agentDir: getAgentDir(),
      settingsManager,
      extensionFactories: [
        makeInterceptionExtension(spec.interceptor, (d) => {
          if (d.denied) deniedSink.push({ tool: d.tool, callId: d.callId, reason: d.reason });
        }),
      ],
    });
    await loader.reload();

    const { session } = await createAgentSession({
      model: resolved.model,
      modelRuntime: runtime,
      tools: spec.tools,
      resourceLoader: loader,
      sessionManager: SessionManager.create(spec.workspaceRoot),
    });
    if (spec.effort && session.getAvailableThinkingLevels().length > 0) {
      const requested = spec.effort === 'max' ? 'xhigh' : spec.effort;
      const available = session.getAvailableThinkingLevels();
      const effective = available.includes(requested as any) ? requested : available.at(-1);
      if (effective) session.setThinkingLevel(effective as any);
    }

    return new SdkSession(session, deniedSink);
  }
}

/** The model pattern Aster asks Pi to resolve. Uses profile allowlist first entry, else provider default. */
function modelPatternOf(spec: SessionSpec): string {
  if (spec.requestedModel) {
    const prefix = `${spec.profile.provider}:`;
    return spec.requestedModel.startsWith(prefix) ? spec.requestedModel.slice(prefix.length) : spec.requestedModel;
  }
  const allow = spec.profile.modelPolicy.allow;
  return allow.length > 0 ? (allow[0] as string) : '';
}

class SdkSession implements PiSession {
  readonly sessionId: string;
  private readonly session: AgentSession;
  private readonly deniedSink: Array<{ tool: string; callId: string; reason: string }>;

  constructor(session: AgentSession, deniedSink: Array<{ tool: string; callId: string; reason: string }>) {
    this.session = session;
    this.sessionId = session.sessionId;
    this.deniedSink = deniedSink;
  }

  async *submit(prompt: string, images: Array<{ data: string; mimeType: string }> = []): AsyncIterable<LawEvent> {
    yield { kind: 'session_started', sessionId: this.sessionId };

    const queue: LawEvent[] = [];
    let notify: (() => void) | null = null;
    let settled = false;
    const push = (e: LawEvent) => {
      queue.push(e);
      notify?.();
    };

    const unsub = this.session.subscribe((ev: AgentSessionEvent) => {
      const mapped = mapPiEvent(ev);
      if (mapped) push(mapped);
      const usage = usageFromPiEvent(ev);
      if (usage) push({ kind: 'usage', ...usage });
      const t = (ev as { type?: string }).type;
      if (t === 'agent_settled' || t === 'agent_end') {
        settled = true;
        notify?.();
      }
    });

    const runPromise = this.session.prompt(prompt, images.length ? { images: images.map((image) => ({ type: 'image' as const, ...image })) } : undefined).catch((err: unknown) => {
      push({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      settled = true;
    });

    try {
      while (!settled || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve;
            // guard against races where settled flipped just before we parked
            if (settled || queue.length > 0) resolve();
          });
          notify = null;
          continue;
        }
        const next = queue.shift();
        if (next) {
          // surface any deny decisions captured by the interception extension
          for (const d of this.deniedSink.splice(0)) {
            yield { kind: 'tool_denied', tool: d.tool, reason: d.reason, callId: d.callId };
          }
          yield next;
        }
      }
      for (const d of this.deniedSink.splice(0)) {
        yield { kind: 'tool_denied', tool: d.tool, reason: d.reason, callId: d.callId };
      }
    } finally {
      unsub();
      await runPromise;
    }
    yield { kind: 'agent_settled' };
  }

  transcriptRef(): TranscriptRef {
    return { sessionId: this.sessionId, storage: 'pi-session' };
  }

  async control(command: string, argument = ''): Promise<string> {
    switch (command) {
      case 'compact': {
        const result = await this.session.compact(argument || undefined);
        return "Context compacted.";
      }
      case 'session':
      case 'stats': {
        const stats = this.session.getSessionStats();
        return `Session ${stats.sessionId}: ${stats.totalMessages} messages, ${stats.toolCalls} tool calls, ${stats.tokens.input} input tokens, ${stats.tokens.output} output tokens, ${stats.tokens.cacheRead} cache-read tokens.`;
      }
      case 'name':
        if (!argument) return this.session.sessionName ? `Session name: ${this.session.sessionName}` : 'This session has no name.';
        this.session.setSessionName(argument); return `Session named “${argument}”.`;
      case 'auto-compact': {
        const enabled = parseToggle(argument, this.session.autoCompactionEnabled);
        this.session.setAutoCompactionEnabled(enabled); return `Automatic compaction ${enabled ? 'enabled' : 'disabled'}.`;
      }
      case 'auto-retry': {
        const enabled = parseToggle(argument, this.session.autoRetryEnabled);
        this.session.setAutoRetryEnabled(enabled); return `Automatic retry ${enabled ? 'enabled' : 'disabled'}.`;
      }
      default: throw new Error(`Unsupported Pi control: /${command}`);
    }
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  dispose(): Promise<void> {
    this.session.dispose();
    return Promise.resolve();
  }
}

function parseToggle(value: string, current: boolean): boolean {
  if (!value) return !current;
  if (['on', 'true', 'enable', 'enabled'].includes(value.toLowerCase())) return true;
  if (['off', 'false', 'disable', 'disabled'].includes(value.toLowerCase())) return false;
  throw new Error('Expected on or off.');
}

/**
 * Map a Pi AgentSessionEvent into a Aster-normalized event (REQ-002). Recognized event
 * `type` names for Pi 0.84.4 are translated; unrecognized events are ignored rather than
 * leaked. Field access is defensive because payloads vary by event type.
 */
export function mapPiEvent(ev: AgentSessionEvent): LawEvent | null {
  const e = ev as { type?: string; [k: string]: unknown };
  switch (e.type) {
    case 'assistant_message': {
      const text = extractText(e);
      return text ? { kind: 'assistant_message', text } : null;
    }
    case 'message_end': {
      const message = e.message as { role?: string; stopReason?: string; errorMessage?: string } | undefined;
      const role = message?.role ?? (typeof e.role === 'string' ? e.role : undefined);
      if (role !== 'assistant') return null;
      const errorMessage = message?.errorMessage ?? (typeof e.errorMessage === 'string' ? e.errorMessage : undefined);
      if (message?.stopReason === 'error' || errorMessage) {
        return { kind: 'error', message: errorMessage || 'The provider ended the response with an error.' };
      }
      const text = extractText(e);
      return text ? { kind: 'assistant_message', text } : null;
    }
    case 'tool_result':
    case 'tool_execution_end': {
      const tool = String(e.toolName ?? e.tool ?? 'tool');
      const ok = !e.isError;
      const callId = String(e.toolCallId ?? e.callId ?? '');
      return { kind: 'tool_result', tool, ok, summary: summarize(e), callId };
    }
    case 'error':
      return { kind: 'error', message: String(e.message ?? 'error') };
    default:
      return null;
  }
}

/** Extract authoritative per-turn provider usage from the finalized assistant message. */
export function usageFromPiEvent(ev: AgentSessionEvent): { input: number; output: number } | null {
  const e = ev as { type?: string; message?: { role?: string; usage?: { input?: unknown; output?: unknown } } };
  if (e.type !== 'message_end' || e.message?.role !== 'assistant' || !e.message.usage) return null;
  const input = typeof e.message.usage.input === 'number' ? e.message.usage.input : 0;
  const output = typeof e.message.usage.output === 'number' ? e.message.usage.output : 0;
  return { input, output };
}

function extractText(e: Record<string, unknown>): string {
  if (typeof e.text === 'string') return e.text;
  const msg = e.message as { content?: unknown } | undefined;
  if (msg && Array.isArray(msg.content)) {
    return msg.content
      .map((c) => (typeof c === 'object' && c && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .join('');
  }
  return '';
}

function summarize(e: Record<string, unknown>): string {
  const r = e.result ?? e.details ?? '';
  const s = typeof r === 'string' ? r : JSON.stringify(r);
  return s.length > 200 ? `${s.slice(0, 197)}...` : s;
}
