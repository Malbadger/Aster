/**
 * Real phase runner: binds to LAW Core's PiAdapter. Opens a bounded session with
 * the phase's tools and the daemon's policy gate as the pre-execution
 * interceptor, submits the prompt, and maps LAW Core's provider-neutral
 * `LawEvent`s to `PhaseEvent`s. Abort aborts the session. Executes where LAW Core
 * `dist/` exists (Ubuntu); deterministic tests use a scripted runner instead.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PhaseEvent, PhaseRunRequest, PhaseRunner } from "./phase-runner.js";

// Minimal shapes of the LAW Core boundary we rely on (kept local to avoid a
// build-time dependency on LAW Core types).
interface LawEventLike {
  kind: string;
  text?: string;
  tool?: string;
  input?: unknown;
  callId?: string;
  ok?: boolean;
  summary?: string;
  reason?: string;
  message?: string;
  output?: number;
}

interface PiSessionLike {
  submit(prompt: string): AsyncIterable<Record<string, unknown>>;
  control?(command: string, argument?: string): Promise<string>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
}
interface PiAdapterLike {
  openSession(spec: unknown): Promise<PiSessionLike>;
}

export class LawCorePhaseRunner implements PhaseRunner {
  private readonly sessions = new Map<string, { binding: string; session: PiSessionLike }>();
  constructor(private readonly lawRoot: string) {}

  async *run(req: PhaseRunRequest): AsyncIterable<PhaseEvent> {
    const binding = `${req.identity.provider}\0${req.identity.model}\0${req.identity.effort}\0${req.workspaceRoot}`;
    let retained = this.sessions.get(req.taskId);
    if (req.prompt.trim() === "/clear") {
      if (retained) await retained.session.dispose().catch(() => {});
      this.sessions.delete(req.taskId);
      yield { kind: "assistant", text: "Started a fresh Pi context for this chat." }; yield { kind: "settled" }; return;
    }
    if (retained && retained.binding !== binding) {
      await retained.session.dispose().catch(() => {}); this.sessions.delete(req.taskId); retained = undefined;
    }
    if (!retained) {
      const mod = (await import(pathToFileURL(join(this.lawRoot, "dist", "pi-adapter", "index.js")).href)) as { createPiAdapter: () => PiAdapterLike };
      const adapter = mod.createPiAdapter();
      // The retained interceptor still calls the daemon-owned gate. Task phases
      // are serialized, and their workspace/tool surface is stable per binding.
      const interceptor = (call: { tool: string; input: unknown; callId: string }) => {
        const d = req.gate({ tool: call.tool, input: call.input, callId: call.callId });
        return { decision: d.allow ? "allow" : "deny", reason: d.reason };
      };
      const session = await adapter.openSession({
        profile: { id: req.identity.model, provider: req.identity.provider, modelPolicy: { allow: [], deny: [] }, locality: "any", authKind: "none" },
        requestedModel: req.identity.model, effort: req.identity.effort, tools: req.tools, interceptor,
        workspaceRoot: req.workspaceRoot, allowMutation: req.allowMutation,
      });
      retained = { binding, session }; this.sessions.set(req.taskId, retained);
    }
    const session = retained.session;

    const control = /^\/(compact|session|stats|name|auto-compact|auto-retry)(?:\s+([\s\S]*))?$/.exec(req.prompt.trim());
    if (control) {
      if (!session.control) { yield { kind: "error", message: "This Pi adapter does not expose session controls." }; return; }
      try { yield { kind: "assistant", text: await session.control(control[1]!, control[2]?.trim()) }; yield { kind: "settled" }; }
      catch (error) { yield { kind: "error", message: error instanceof Error ? error.message : String(error) }; }
      return;
    }

    const onAbort = () => void session.abort().catch(() => {});
    req.signal.addEventListener("abort", onAbort, { once: true });

    try {
      for await (const raw of session.submit(req.prompt)) {
        const e = raw as unknown as LawEventLike;
        const mapped = mapEvent(e);
        if (mapped) yield mapped;
        if (req.signal.aborted) break;
      }
    } finally {
      req.signal.removeEventListener("abort", onAbort);
    }
  }
}

function mapEvent(e: LawEventLike): PhaseEvent | undefined {
  switch (e.kind) {
    case "assistant_message":
      return { kind: "assistant", text: String(e.text ?? "") };
    case "tool_call":
      return { kind: "tool_call", tool: String(e.tool ?? ""), input: e.input, callId: String(e.callId ?? "") };
    case "tool_result":
      return { kind: "tool_result", tool: String(e.tool ?? ""), ok: Boolean(e.ok), summary: String(e.summary ?? ""), callId: String(e.callId ?? "") };
    case "tool_denied":
      return { kind: "tool_denied", tool: String(e.tool ?? ""), reason: String(e.reason ?? ""), callId: String(e.callId ?? "") };
    case "usage":
      return { kind: "usage", input: Number(e.input ?? 0), output: Number(e.output ?? 0) };
    case "agent_settled":
      return { kind: "settled" };
    case "error":
      return { kind: "error", message: String(e.message ?? "error") };
    default:
      return undefined;
  }
}
