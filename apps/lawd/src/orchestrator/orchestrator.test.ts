import { describe, expect, it } from "vitest";
import { Orchestrator } from "./orchestrator.js";
import { MemoryTaskStore } from "./task-store.js";
import type { PhaseEvent, PhaseRunRequest, PhaseRunner } from "./phase-runner.js";
import type { PhaseIdentity } from "@law/contracts";

const IDENTITY: PhaseIdentity = { provider: "ollama", model: "llama3.1:8b", effort: "medium" };

/** A scripted runner: emits an assistant line, one tool call (gated), then settles. */
class ScriptedRunner implements PhaseRunner {
  constructor(private readonly tool = "read_file", private readonly input: unknown = { path: "a.ts" }) {}
  async *run(req: PhaseRunRequest): AsyncIterable<PhaseEvent> {
    yield { kind: "assistant", text: `Working on: ${req.prompt}` };
    const decision = req.gate({ tool: this.tool, input: this.input, callId: "c1" });
    if (decision.allow) {
      yield { kind: "tool_call", tool: this.tool, input: this.input, callId: "c1" };
      yield { kind: "tool_result", tool: this.tool, ok: true, summary: "ok", callId: "c1" };
    } else {
      yield { kind: "tool_denied", tool: this.tool, reason: decision.reason, callId: "c1" };
    }
    yield { kind: "settled" };
  }
}

/** A runner that blocks until released OR aborted, to test cancellation. */
class BlockingRunner implements PhaseRunner {
  release: () => void = () => {};
  async *run(req: PhaseRunRequest): AsyncIterable<PhaseEvent> {
    yield { kind: "assistant", text: "starting" };
    await new Promise<void>((resolve) => {
      if (req.signal.aborted) return resolve();
      req.signal.addEventListener("abort", () => resolve(), { once: true });
      this.release = resolve;
    });
    if (req.signal.aborted) return;
    yield { kind: "settled" };
  }
}

function make(runner: PhaseRunner) {
  const store = new MemoryTaskStore();
  const orch = new Orchestrator({ store, runner, netState: () => ({ offlineLocalOnly: true, remoteAuthorized: false }), workspaceRootFor: () => "/work/ws" });
  return { store, orch };
}

describe("Orchestrator", () => {
  it("runs a natural-language turn as a phase and streams chronological events", async () => {
    const { orch } = make(new ScriptedRunner());
    const { task } = orch.createTask({ title: "chat", defaultIdentity: IDENTITY });
    const res = orch.sendMessage({ taskId: task.taskId, text: "please read a.ts" });
    expect(res.accepted).toBe(true);
    expect(res.status).toBe("running");
    await orch.idle(task.taskId);
    const { events, taskStatus } = orch.getEvents(task.taskId, 0);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("user");
    expect(kinds).toContain("plan");
    expect(kinds).toContain("assistant");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");
    expect(taskStatus).toBe("active");
    const phase = orch.getTask(task.taskId).phases[0]!;
    expect(phase.status).toBe("completed");
    expect(phase.identity).toEqual(IDENTITY);
  });

  it("denies a tool that is not on the allowlist (gate enforced before effect)", async () => {
    const { orch } = make(new ScriptedRunner("exec_shell", { cmd: "rm -rf /" }));
    const { task } = orch.createTask({ title: "chat", defaultIdentity: IDENTITY });
    orch.sendMessage({ taskId: task.taskId, text: "do it" });
    await orch.idle(task.taskId);
    const denied = orch.getEvents(task.taskId, 0).events.find((e) => e.kind === "tool_denied");
    expect(denied).toBeTruthy();
  });

  it("refuses to run without a selected model", () => {
    const { orch } = make(new ScriptedRunner());
    const { task } = orch.createTask({ title: "chat" });
    const res = orch.sendMessage({ taskId: task.taskId, text: "hello" });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/no model selected/);
  });

  it("keeps an unknown slash command editable and does not execute", () => {
    const { orch } = make(new ScriptedRunner());
    const { task } = orch.createTask({ title: "chat", defaultIdentity: IDENTITY });
    const res = orch.sendMessage({ taskId: task.taskId, text: "/frobnicate x" });
    expect(res.accepted).toBe(false);
    expect(res.interpretation.type).toBe("unknown-command");
  });

  it("handles /help as a deterministic non-phase command", () => {
    const { orch } = make(new ScriptedRunner());
    const { task } = orch.createTask({ title: "chat", defaultIdentity: IDENTITY });
    const res = orch.sendMessage({ taskId: task.taskId, text: "/help" });
    expect(res.status).toBe("completed");
    expect(orch.getEvents(task.taskId, 0).events.some((e) => e.text?.includes("/plan"))).toBe(true);
  });

  it("cancels a running phase with a typed cancelled outcome", async () => {
    const runner = new BlockingRunner();
    const { orch } = make(runner);
    const { task } = orch.createTask({ title: "chat", defaultIdentity: IDENTITY });
    orch.sendMessage({ taskId: task.taskId, text: "long task" });
    const c = await orch.cancel(task.taskId);
    runner.release();
    await orch.idle(task.taskId);
    expect(c.cancellation).toBe("confirmed");
    expect(orch.getTask(task.taskId).phases[0]!.status).toBe("cancelled");
  });

  it("serves events incrementally by cursor", async () => {
    const { orch } = make(new ScriptedRunner());
    const { task } = orch.createTask({ title: "chat", defaultIdentity: IDENTITY });
    orch.sendMessage({ taskId: task.taskId, text: "go" });
    await orch.idle(task.taskId);
    const first = orch.getEvents(task.taskId, 0);
    const tail = orch.getEvents(task.taskId, first.nextSeq);
    expect(tail.events.length).toBe(0);
    expect(tail.nextSeq).toBe(first.nextSeq);
  });
});
