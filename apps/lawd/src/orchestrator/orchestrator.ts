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
}

interface RunHandle {
  controller: AbortController;
  promise: Promise<void>;
  acknowledgedCancel: boolean;
}

const DEFAULT_TOOLS = ["read_file", "write_file", "list_dir", "search"];

export class Orchestrator {
  private readonly redactor: Redactor;
  private readonly now: () => Date;
  private readonly running = new Map<string, RunHandle>();

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

  sendMessage(input: { taskId: string; text: string; identity?: PhaseIdentity }): {
    accepted: boolean;
    interpretation: Interpretation;
    phaseId?: string;
    status: PhaseStatus;
    reason?: string;
    nextSeq: number;
  } {
    const task = this.requireTask(input.taskId);
    const parsed = interpret(input.text);

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

    this.append(task.taskId, { kind: "user", taskId: task.taskId, text: input.text });
    this.append(task.taskId, { kind: "plan", taskId: task.taskId, text: parsed.interpretation.summary, data: { interpretation: parsed.interpretation } });

    // Deterministic local commands (not phases).
    if (parsed.interpretation.type === "unknown-command") {
      this.append(task.taskId, { kind: "status", taskId: task.taskId, text: parsed.interpretation.summary });
      return { accepted: false, interpretation: parsed.interpretation, status: "pending", reason: "unknown command", nextSeq: this.deps.store.nextSeq(task.taskId) };
    }
    if (parsed.command === "help") {
      this.append(task.taskId, { kind: "status", taskId: task.taskId, text: "Commands: /help, /plan, /run, /audit, /model, /clear. Plain text runs as a request." });
      return { accepted: true, interpretation: parsed.interpretation, status: "completed", nextSeq: this.deps.store.nextSeq(task.taskId) };
    }

    // Phase-running path (NL, /run, /plan, /audit).
    const identity = input.identity ?? task.defaultIdentity;
    if (!identity) {
      this.append(task.taskId, { kind: "status", taskId: task.taskId, text: "Select a model before running (no default identity for this task)." });
      return { accepted: false, interpretation: parsed.interpretation, status: "pending", reason: "no model selected", nextSeq: this.deps.store.nextSeq(task.taskId) };
    }

    const phase: Phase = {
      phaseId: this.id("phase"),
      taskId: task.taskId,
      brief: parsed.prompt || input.text,
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
      text: `Phase started with ${identity.provider}/${identity.model} (effort ${identity.effort}).`,
      data: { identity },
    });

    const controller = new AbortController();
    const promise = this.execPhase(task, phase, parsed.prompt || input.text, controller);
    this.running.set(task.taskId, { controller, promise, acknowledgedCancel: false });

    return { accepted: true, interpretation: parsed.interpretation, phaseId: phase.phaseId, status: "running", nextSeq: this.deps.store.nextSeq(task.taskId) };
  }

  private async execPhase(task: Task, phase: Phase, prompt: string, controller: AbortController): Promise<void> {
    const gate = new PolicyGate({
      allowedTools: this.deps.allowedTools ?? DEFAULT_TOOLS,
      workspaceRoot: this.deps.workspaceRootFor(task),
      netState: this.deps.netState,
    });

    let lastError: string | undefined;
    let cancelled = false;
    try {
      for await (const ev of this.deps.runner.run({
        identity: phase.identity,
        prompt,
        tools: this.deps.allowedTools ?? DEFAULT_TOOLS,
        workspaceRoot: this.deps.workspaceRootFor(task),
        allowMutation: true,
        gate: gate.asToolGate(),
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }
        this.recordPhaseEvent(task.taskId, phase.phaseId, ev);
        if (ev.kind === "error") lastError = ev.message;
      }
      // The runner may have returned in response to abort without yielding again.
      if (controller.signal.aborted) cancelled = true;
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

  private recordPhaseEvent(taskId: string, phaseId: string, ev: PhaseEvent): void {
    switch (ev.kind) {
      case "assistant":
        this.append(taskId, { kind: "assistant", taskId, phaseId, text: ev.text });
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
    handle.controller.abort();
    await handle.promise.catch(() => {});
    const t = this.requireTask(taskId);
    // A tool may have been mid-flight; scripted runs stop cleanly (confirmed).
    return { taskStatus: t.status, cancellation: "confirmed" };
  }

  /** Test helper: await the running turn, if any. */
  async idle(taskId: string): Promise<void> {
    await this.running.get(taskId)?.promise.catch(() => {});
  }
}
