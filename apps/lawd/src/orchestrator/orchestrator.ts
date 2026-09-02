/**
 * Orchestrator (BUILD-D-008/009/010/011). Runs a chat turn as a bounded phase
 * with a LOCKED identity (RULE-D-003), streams provider-neutral events into an
 * append-only chat log (chronological, chat-native — no ribbon), enforces the
 * policy gate via the runner, redacts every stored event, and supports typed
 * cancellation. Turns run in the background so cancellation can interleave; tests
 * await `idle(taskId)`.
 */
import { randomUUID } from "node:crypto";
import type {
  ChatEvent,
  Interpretation,
  Phase,
  PhaseIdentity,
  PhaseStatus,
  Task,
  TaskStatus,
} from "@law/contracts";
import { Redactor } from "../security/redaction.js";
import { PolicyGate } from "../policy/gate.js";
import type { NetPolicyState } from "../security/net-policy.js";
import type { PhaseEvent, PhaseRunner } from "./phase-runner.js";
import type { ResolvedAttachment } from "../attachment/attachment-service.js";
import { interpret } from "./interpret.js";
import type { TaskStore } from "./task-store.js";

export interface OrchestratorDeps {
  store: TaskStore;
  runner: PhaseRunner;
  redactor?: Redactor;
  netState: () => NetPolicyState;
  workspaceRootFor: (task: Task) => string;
  allowedTools?: string[];
  now?: () => Date;
  attachments?: { resolve(ids: string[]): ResolvedAttachment[] };
  orchestrationGuide?: string;
}

interface RunHandle {
  controller: AbortController;
  promise: Promise<void>;
  acknowledgedCancel: boolean;
}

interface PendingApproval {
  taskId: string;
  resolve: (decision: { allow: boolean; reason: string }) => void;
}

const DEFAULT_TOOLS = ["read", "write", "edit", "grep", "find", "ls", "bash", "read_file", "write_file", "list_dir", "search"];
const MUTATING_TOOL = /(^|_)(write|edit|delete|remove|move|rename|mkdir|touch|bash|shell|command|execute|apply)(_|$)/i;

export class Orchestrator {
  private readonly redactor: Redactor;
  private readonly now: () => Date;
  private readonly running = new Map<string, RunHandle>();
  private readonly approvals = new Map<string, PendingApproval>();

  constructor(private readonly deps: OrchestratorDeps) {
    this.redactor = deps.redactor ?? new Redactor();
    this.now = deps.now ?? (() => new Date());
  }

  private id(prefix: string): string {
    return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }

  createTask(input: { title: string; workspaceId?: string; defaultIdentity?: PhaseIdentity }): { task: Task } {
    const at = this.now().toISOString();
    const task: Task = {
      taskId: this.id("task"),
      title: input.title,
      status: "active",
      createdAt: at,
      updatedAt: at,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.defaultIdentity ? { defaultIdentity: input.defaultIdentity } : {}),
    };
    this.deps.store.createTask(task);
    return { task };
  }

  listTasks(query: string): { tasks: Task[] } {
    return { tasks: this.deps.store.listTasks(query) };
  }

  deleteTask(taskId: string): { deleted: boolean } {
    this.requireTask(taskId);
    if (this.running.has(taskId)) {
      throw Object.assign(new Error("Stop this chat before deleting it."), { code: "TASK_ACTIVE" });
    }
    return { deleted: this.deps.store.deleteTask(taskId) };
  }

  rewindTask(taskId: string, userSeq: number): { task: Task; events: ChatEvent[]; draft: string } {
    const source = this.requireTask(taskId);
    if (this.running.has(taskId)) {
      throw Object.assign(new Error("Stop this chat before rewinding it."), { code: "TASK_ACTIVE" });
    }
    const sourceEvents = this.deps.store.getEvents(taskId, 0);
    const pivot = sourceEvents.find((event) => event.seq === userSeq && event.kind === "user");
    if (!pivot?.text) throw Object.assign(new Error("That prompt is no longer available to rewind."), { code: "NOT_FOUND" });

    const prior = sourceEvents.filter((event) => event.seq < userSeq);
    const contextSeed = conversationSeed(prior);
    const at = this.now().toISOString();
    const task: Task = {
      taskId: this.id("task"),
      title: `${source.title} · rewind`,
      status: "active",
      createdAt: at,
      updatedAt: at,
      ...(source.workspaceId ? { workspaceId: source.workspaceId } : {}),
      ...(source.defaultIdentity ? { defaultIdentity: source.defaultIdentity } : {}),
      ...(contextSeed ? { contextSeed } : {}),
    };
    this.deps.store.createTask(task);
    for (const event of prior) {
      this.deps.store.appendEvent(task.taskId, {
        ...event,
        id: this.id("evt"),
        taskId: task.taskId,
        phaseId: undefined,
      });
    }
    return { task, events: this.deps.store.getEvents(task.taskId, 0), draft: pivot.text };
  }

  getTask(taskId: string): { task: Task; phases: Phase[] } {
    const task = this.requireTask(taskId);
    return { task, phases: this.deps.store.getPhases(taskId) };
  }

  getEvents(taskId: string, sinceSeq: number): { events: ChatEvent[]; nextSeq: number; taskStatus: TaskStatus } {
    const task = this.requireTask(taskId);
    return {
      events: this.deps.store.getEvents(taskId, sinceSeq),
      nextSeq: this.deps.store.nextSeq(taskId),
      taskStatus: task.status,
    };
  }

  usageSummary(): { measuredSince?: string; providers: Array<{ provider: string; input: number; output: number; total: number; models: Array<{ model: string; input: number; output: number; total: number }> }> } {
    const tasks = this.deps.store.listTasks("");
    const totals = new Map<string, Map<string, { input: number; output: number }>>();
    for (const task of tasks) {
      const phases = new Map(this.deps.store.getPhases(task.taskId).map((phase) => [phase.phaseId, phase.identity]));
      for (const event of this.deps.store.getEvents(task.taskId, 0)) {
        const usage = event.data?.usage as { input?: unknown; output?: unknown } | undefined;
        const identity = event.phaseId ? phases.get(event.phaseId) : undefined;
        if (!usage || !identity) continue;
        const input = typeof usage.input === "number" ? usage.input : 0;
        const output = typeof usage.output === "number" ? usage.output : 0;
        const models = totals.get(identity.provider) ?? new Map<string, { input: number; output: number }>();
        const current = models.get(identity.model) ?? { input: 0, output: 0 };
        current.input += input; current.output += output;
        models.set(identity.model, current); totals.set(identity.provider, models);
      }
    }
    const providers = [...totals.entries()].map(([provider, modelTotals]) => {
      const models = [...modelTotals.entries()].map(([model, usage]) => ({ model, ...usage, total: usage.input + usage.output })).sort((a, b) => b.total - a.total);
      const input = models.reduce((sum, model) => sum + model.input, 0);
      const output = models.reduce((sum, model) => sum + model.output, 0);
      return { provider, input, output, total: input + output, models };
    }).sort((a, b) => b.total - a.total);
    const measuredSince = tasks.map((task) => task.createdAt).sort().at(0);
    return { ...(measuredSince ? { measuredSince } : {}), providers };
  }

  private requireTask(taskId: string): Task {
    const t = this.deps.store.getTask(taskId);
    if (!t) throw Object.assign(new Error(`no such task: ${taskId}`), { code: "NOT_FOUND" });
    return t;
  }

  private append(taskId: string, e: Omit<ChatEvent, "seq" | "id" | "at">): ChatEvent {
    const redactedData = e.data ? this.redactor.redact(e.data) : undefined;
    return this.deps.store.appendEvent(taskId, {
      id: this.id("evt"),
      at: this.now().toISOString(),
      ...e,
      ...(redactedData ? { data: redactedData } : {}),
    });
  }

  sendMessage(input: { taskId: string; text: string; identity?: PhaseIdentity; attachmentIds?: string[]; attachmentEgressApproved?: boolean }): {
    accepted: boolean;
    interpretation: Interpretation;
    phaseId?: string;
    status: PhaseStatus;
    reason?: string;
    nextSeq: number;
  } {
    const task = this.requireTask(input.taskId);
    const parsed = interpret(input.text);
    const piControl = parsed.command && ["clear", "compact", "session", "stats", "name", "auto-compact", "auto-retry"].includes(parsed.command);
    const phasePrompt = piControl || parsed.interpretation.type === "unknown-command" ? input.text.trim() : parsed.prompt || input.text;

    // One turn at a time — a mid-phase identity change is refused (RULE-D-003).
    if (this.running.has(task.taskId)) {
      this.append(task.taskId, { kind: "user", taskId: task.taskId, text: input.text });
      this.append(task.taskId, {
        kind: "status",
        taskId: task.taskId,
        text: "A phase is already running; its provider/model/effort is locked. This message will need a new turn after it settles.",
      });
      return { accepted: false, interpretation: parsed.interpretation, status: "running", reason: "phase in progress", nextSeq: this.deps.store.nextSeq(task.taskId) };
    }

    const attachments = this.deps.attachments?.resolve(input.attachmentIds ?? []) ?? [];
    const preflightIdentity = input.identity ?? task.defaultIdentity;
    if (attachments.length && preflightIdentity && preflightIdentity.locality !== "local" && !input.attachmentEgressApproved) {
      throw Object.assign(new Error("Confirm the remote attachment disclosure before sending local files to this model."), { code: "EGRESS_APPROVAL_REQUIRED" });
    }
    const attachmentMeta = attachments.map(({ attachmentId, name, mimeType, size, kind }) => ({ attachmentId, name, mimeType, size, kind }));
    this.append(task.taskId, { kind: "user", taskId: task.taskId, text: input.text, ...(attachmentMeta.length ? { data: { attachments: attachmentMeta, attachmentEgressApproved: Boolean(input.attachmentEgressApproved) } } : {}) });
    // Deterministic local commands (not phases). Unknown slash commands pass
    // through to Pi so installed extensions retain their native command surface.
    if (parsed.command === "help") {
      this.append(task.taskId, { kind: "assistant", taskId: task.taskId, text: "Commands: /plan, /run, /audit, /model, /effort, /mode, /login, /logout, /compact, /session, /name, /auto-compact, /auto-retry, /clear. Plain text runs through the retained Pi session." });
      return { accepted: true, interpretation: parsed.interpretation, status: "completed", nextSeq: this.deps.store.nextSeq(task.taskId) };
    }

    // Phase-running path (NL, /run, /plan, /audit).
    const selectedIdentity = preflightIdentity;
    const identity = selectedIdentity && parsed.command === "plan" ? { ...selectedIdentity, mode: "plan" as const } : selectedIdentity;
    if (!identity) {
      this.append(task.taskId, { kind: "status", taskId: task.taskId, text: "Select a model before running (no default identity for this task)." });
      return { accepted: false, interpretation: parsed.interpretation, status: "pending", reason: "no model selected", nextSeq: this.deps.store.nextSeq(task.taskId) };
    }

    const phase: Phase = {
      phaseId: this.id("phase"),
      taskId: task.taskId,
      brief: phasePrompt,
      identity,
      status: "running",
      startedAt: this.now().toISOString(),
    };
    if (task.status !== "active") this.deps.store.updateTask({ ...task, status: "active", updatedAt: this.now().toISOString() });
    this.deps.store.addPhase(phase);
    this.append(task.taskId, {
      kind: "status",
      taskId: task.taskId,
      phaseId: phase.phaseId,
      text: `Phase started with ${identity.provider}/${identity.model} (effort ${identity.effort}, mode ${identity.mode ?? "manual"}).`,
      data: { identity },
    });

    const controller = new AbortController();
    let executionPrompt = task.contextSeed && this.deps.store.getPhases(task.taskId).length === 1
      ? `${task.contextSeed}\n\nContinue from that conversation with this new user message:\n${phasePrompt}`
      : phasePrompt;
    if (this.deps.orchestrationGuide && requestsModelOrchestration(phasePrompt)) {
      executionPrompt = `${this.deps.orchestrationGuide}\n\nCurrent coordinating Aster phase mode: ${identity.mode ?? "manual"}. Apply the Aster orchestration skill above to this user request:\n${executionPrompt}`;
    }
    const promise = this.execPhase(task, phase, executionPrompt, controller, attachments);
    this.running.set(task.taskId, { controller, promise, acknowledgedCancel: false });

    return { accepted: true, interpretation: parsed.interpretation, phaseId: phase.phaseId, status: "running", nextSeq: this.deps.store.nextSeq(task.taskId) };
  }

  private async execPhase(task: Task, phase: Phase, prompt: string, controller: AbortController, attachments: ResolvedAttachment[]): Promise<void> {
    const gate = new PolicyGate({
      allowedTools: this.deps.allowedTools ?? DEFAULT_TOOLS,
      workspaceRoot: this.deps.workspaceRootFor(task),
      netState: this.deps.netState,
    });

    const mode = phase.identity.mode ?? "manual";
    const toolGate = async (call: { tool: string; input: unknown; callId: string }) => {
      const base = gate.decide(call);
      if (!base.allow) return base;
      const mutating = MUTATING_TOOL.test(call.tool);
      if (!mutating) return base;
      if (mode === "plan") return { allow: false, reason: "Plan mode is read-only." };
      if (mode === "auto" || mode === "full-access") return base;
      const approvalId = this.id("approval");
      this.append(task.taskId, {
        kind: "approval", taskId: task.taskId, phaseId: phase.phaseId,
        text: `${call.tool} wants permission to make a change.`,
        data: { approvalId, tool: call.tool, input: call.input, status: "pending" },
      });
      return new Promise<{ allow: boolean; reason: string }>((resolve) => {
        this.approvals.set(approvalId, { taskId: task.taskId, resolve });
      });
    };

    let lastError: string | undefined;
    let cancelled = false;
    let assistantProduced = false;
    try {
      for await (const ev of this.deps.runner.run({
        taskId: task.taskId,
        identity: phase.identity,
        prompt,
        attachments: attachments,
        tools: this.deps.allowedTools ?? DEFAULT_TOOLS,
        workspaceRoot: this.deps.workspaceRootFor(task),
        allowMutation: mode !== "plan",
        gate: toolGate,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }
        this.recordPhaseEvent(task.taskId, phase.phaseId, phase.identity, ev);
        if (ev.kind === "assistant" && ev.text.trim().length > 0) assistantProduced = true;
        if (ev.kind === "error") lastError = ev.message;
      }
      // The runner may have returned in response to abort without yielding again.
      if (controller.signal.aborted) cancelled = true;
      if (!cancelled && !lastError && !assistantProduced) {
        lastError = "Model completed without returning a response.";
        this.append(task.taskId, { kind: "error", taskId: task.taskId, phaseId: phase.phaseId, text: lastError });
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : "phase runner failed";
      this.append(task.taskId, { kind: "error", taskId: task.taskId, phaseId: phase.phaseId, text: lastError });
    }

    const status: PhaseStatus = cancelled ? "cancelled" : lastError ? "error" : "completed";
    const ended = { ...phase, status, endedAt: this.now().toISOString() };
    this.deps.store.updatePhase(ended);
    this.append(task.taskId, {
      kind: "status",
      taskId: task.taskId,
      phaseId: phase.phaseId,
      text: `Phase ${status}.`,
      data: { status },
    });

    // A completed turn settles the task for UI polling. A later message moves
    // it back to active before starting its next phase.
    if (status === "cancelled" || status === "error") {
      const t = this.deps.store.getTask(task.taskId);
      if (t) this.deps.store.updateTask({ ...t, status: status === "cancelled" ? "cancelled" : "error", updatedAt: this.now().toISOString() });
    } else {
      const t = this.deps.store.getTask(task.taskId);
      if (t) this.deps.store.updateTask({ ...t, status: "completed", updatedAt: this.now().toISOString() });
    }
    this.running.delete(task.taskId);
  }

  private recordPhaseEvent(taskId: string, phaseId: string, identity: PhaseIdentity, ev: PhaseEvent): void {
    switch (ev.kind) {
      case "assistant":
        this.append(taskId, { kind: "assistant", taskId, phaseId, text: ev.text, data: { identity } });
        break;
      case "tool_call":
        this.append(taskId, { kind: "tool_call", taskId, phaseId, text: ev.tool, data: { tool: ev.tool, input: ev.input, callId: ev.callId } });
        break;
      case "tool_result":
        this.append(taskId, { kind: "tool_result", taskId, phaseId, text: ev.summary, data: { tool: ev.tool, ok: ev.ok, callId: ev.callId } });
        break;
      case "tool_denied":
        this.append(taskId, { kind: "tool_denied", taskId, phaseId, text: ev.reason, data: { tool: ev.tool, callId: ev.callId } });
        break;
      case "usage":
        this.append(taskId, { kind: "status", taskId, phaseId, text: `usage in=${ev.input} out=${ev.output}`, data: { usage: { input: ev.input, output: ev.output } } });
        break;
      case "error":
        this.append(taskId, { kind: "error", taskId, phaseId, text: ev.message });
        break;
      case "settled":
        break;
    }
  }

  async cancel(taskId: string): Promise<{ taskStatus: TaskStatus; cancellation: "confirmed" | "uncertain" }> {
    this.requireTask(taskId);
    const handle = this.running.get(taskId);
    if (!handle) {
      const t = this.requireTask(taskId);
      return { taskStatus: t.status, cancellation: "confirmed" };
    }
    for (const [id, pending] of this.approvals) {
      if (pending.taskId === taskId) {
        pending.resolve({ allow: false, reason: "Denied because the task was cancelled." });
        this.approvals.delete(id);
      }
    }
    handle.controller.abort();
    await handle.promise.catch(() => {});
    const t = this.requireTask(taskId);
    // A tool may have been mid-flight; scripted runs stop cleanly (confirmed).
    return { taskStatus: t.status, cancellation: "confirmed" };
  }

  respondApproval(taskId: string, approvalId: string, approved: boolean): boolean {
    this.requireTask(taskId);
    const pending = this.approvals.get(approvalId);
    if (!pending || pending.taskId !== taskId) return false;
    this.approvals.delete(approvalId);
    pending.resolve({ allow: approved, reason: approved ? "Approved by the user in Manual mode." : "Denied by the user in Manual mode." });
    this.append(taskId, { kind: "status", taskId, text: approved ? "Tool change approved." : "Tool change denied.", data: { approvalId, status: approved ? "approved" : "denied" } });
    return true;
  }

  /** Test helper: await the running turn, if any. */
  async idle(taskId: string): Promise<void> {
    await this.running.get(taskId)?.promise.catch(() => {});
  }
}

function conversationSeed(events: ChatEvent[]): string {
  const lines = events
    .filter((event) => event.kind === "user" || event.kind === "assistant")
    .map((event) => `${event.kind === "user" ? "User" : "Assistant"}: ${event.text ?? ""}`);
  if (!lines.length) return "";
  const transcript = lines.join("\n\n");
  const bounded = transcript.length > 48_000 ? transcript.slice(-48_000) : transcript;
  return `Conversation context from before a user-requested rewind:\n${bounded}`;
}

function requestsModelOrchestration(prompt: string): boolean {
  if (/do not delegate further/i.test(prompt)) return false;
  const action = /\b(delegate|hand off|ask|call|review|audit|verify|then|orchestrat)/i.test(prompt);
  const target = /\b(claude|openai|chatgpt|codex|gemini|antigravity|ollama|qwen|model|provider)\b/i.test(prompt);
  return action && target;
}
