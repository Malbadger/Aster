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
    const decision = await req.gate({ tool: this.tool, input: this.input, callId: "c1" });
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
  it("treats a settled phase with no assistant response as an error", async () => {
    const runner: PhaseRunner = { async *run() { yield { kind: "settled" }; } };
    const { orch } = make(runner);
    const { task } = orch.createTask({ title: "empty", defaultIdentity: IDENTITY });
    orch.sendMessage({ taskId: task.taskId, text: "respond" });
    await orch.idle(task.taskId);
    const result = orch.getEvents(task.taskId, 0);
    expect(result.taskStatus).toBe("error");
    expect(result.events.some((event) => event.kind === "error" && event.text?.includes("without returning a response"))).toBe(true);
  });
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
    expect(kinds).not.toContain("plan");
    expect(kinds).toContain("assistant");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");
    expect(taskStatus).toBe("completed");
    const phase = orch.getTask(task.taskId).phases[0]!;
    expect(phase.status).toBe("completed");
    expect(phase.identity).toEqual(IDENTITY);
    const assistant = events.find((event) => event.kind === "assistant");
    expect(assistant?.data?.identity).toEqual(IDENTITY);
  });

  it("persists an explicitly selected coordinator without consulting provider defaults", async () => {
    const { orch } = make(new ScriptedRunner());
    const providerDefault = { provider: "anthropic", model: "anthropic:claude-opus-4-8", effort: "medium", mode: "full-access" } as const;
    const active = { ...providerDefault, model: "anthropic:claude-opus-5" };
    const { task } = orch.createTask({ title: "coordinator", defaultIdentity: providerDefault });
    orch.sendMessage({ taskId: task.taskId, text: "orchestrate", identity: active });
    await orch.idle(task.taskId);
    expect(orch.getTask(task.taskId).task.defaultIdentity).toEqual(active);
    expect(orch.getTask(task.taskId).phases[0]?.identity).toEqual(active);
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

  it("passes an unknown slash command intact to Pi", async () => {
    const { orch } = make(new ScriptedRunner());
    const { task } = orch.createTask({ title: "chat", defaultIdentity: IDENTITY });
    const res = orch.sendMessage({ taskId: task.taskId, text: "/frobnicate x" });
    expect(res.accepted).toBe(true);
    expect(res.interpretation.type).toBe("unknown-command");
    await orch.idle(task.taskId);
    expect(orch.getEvents(task.taskId, 0).events.some((e) => e.text?.includes("Working on: /frobnicate x"))).toBe(true);
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

  it("deletes an inactive chat and all of its stored history", () => {
    const { orch } = make(new ScriptedRunner());
    const { task } = orch.createTask({ title: "temporary" });
    expect(orch.deleteTask(task.taskId)).toEqual({ deleted: true });
    expect(orch.listTasks("").tasks).toHaveLength(0);
    expect(() => orch.getEvents(task.taskId, 0)).toThrow(/no such task/);
  });

  it("makes Plan read-only, Manual approval-driven, and Auto non-interactive", async () => {
    const plan = make(new ScriptedRunner("write_file", { path: "a.ts" }));
    const planTask = plan.orch.createTask({ title: "plan", defaultIdentity: { ...IDENTITY, mode: "plan" } }).task;
    plan.orch.sendMessage({ taskId: planTask.taskId, text: "change it" });
    await plan.orch.idle(planTask.taskId);
    expect(plan.orch.getEvents(planTask.taskId, 0).events.some((event) => event.kind === "tool_denied" && event.text?.includes("read-only"))).toBe(true);

    const manual = make(new ScriptedRunner("write_file", { path: "a.ts" }));
    const manualTask = manual.orch.createTask({ title: "manual", defaultIdentity: { ...IDENTITY, mode: "manual" } }).task;
    manual.orch.sendMessage({ taskId: manualTask.taskId, text: "change it" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const approval = manual.orch.getEvents(manualTask.taskId, 0).events.find((event) => event.kind === "approval");
    expect(approval?.data?.approvalId).toBeTypeOf("string");
    expect(manual.orch.respondApproval(manualTask.taskId, String(approval?.data?.approvalId), true)).toBe(true);
    await manual.orch.idle(manualTask.taskId);
    expect(manual.orch.getEvents(manualTask.taskId, 0).events.some((event) => event.kind === "tool_result")).toBe(true);

    const auto = make(new ScriptedRunner("write_file", { path: "a.ts" }));
    const autoTask = auto.orch.createTask({ title: "auto", defaultIdentity: { ...IDENTITY, mode: "auto" } }).task;
    auto.orch.sendMessage({ taskId: autoTask.taskId, text: "change it" });
    await auto.orch.idle(autoTask.taskId);
    expect(auto.orch.getEvents(autoTask.taskId, 0).events.some((event) => event.kind === "approval")).toBe(false);
    expect(auto.orch.getEvents(autoTask.taskId, 0).events.some((event) => event.kind === "tool_result")).toBe(true);
  });

  it("requires explicit egress approval and passes only resolved attachments to the runner", async () => {
    let seen: PhaseRunRequest | undefined;
    const runner: PhaseRunner = { async *run(req) { seen = req; yield { kind: "settled" }; } };
    const store = new MemoryTaskStore();
    const orch = new Orchestrator({
      store, runner, netState: () => ({ offlineLocalOnly: true, remoteAuthorized: false }), workspaceRootFor: () => "/work/ws",
      attachments: { resolve: () => [{ attachmentId: "att-1", name: "brief.md", mimeType: "text/plain", size: 6, kind: "text", stagedPath: "/private/brief.md", text: "secret" }] },
    });
    const identity: PhaseIdentity = { ...IDENTITY, locality: "remote" };
    const task = orch.createTask({ title: "attachments", defaultIdentity: identity }).task;
    expect(() => orch.sendMessage({ taskId: task.taskId, text: "review", attachmentIds: ["att-1"] })).toThrow(/Confirm the remote attachment disclosure/);
    orch.sendMessage({ taskId: task.taskId, text: "review", attachmentIds: ["att-1"], attachmentEgressApproved: true });
    await orch.idle(task.taskId);
    expect(seen?.attachments?.[0]?.text).toBe("secret");
    const user = orch.getEvents(task.taskId, 0).events.find((event) => event.kind === "user");
    expect(user?.data?.attachments).toEqual([expect.objectContaining({ name: "brief.md", kind: "text" })]);
    expect(JSON.stringify(user?.data)).not.toContain("secret");
  });

  it("rewinds by creating a safe branch and restores the selected prompt", async () => {
    const { orch } = make(new ScriptedRunner());
    const original = orch.createTask({ title: "chat", defaultIdentity: IDENTITY }).task;
    orch.sendMessage({ taskId: original.taskId, text: "first prompt" }); await orch.idle(original.taskId);
    orch.sendMessage({ taskId: original.taskId, text: "second prompt" }); await orch.idle(original.taskId);
    const pivot = orch.getEvents(original.taskId, 0).events.find((event) => event.kind === "user" && event.text === "second prompt")!;
    const branch = orch.rewindTask(original.taskId, pivot.seq);
    expect(branch.task.taskId).not.toBe(original.taskId);
    expect(branch.task.title).toContain("rewind");
    expect(branch.draft).toBe("second prompt");
    expect(branch.events.some((event) => event.text === "first prompt")).toBe(true);
    expect(branch.events.some((event) => event.text === "second prompt")).toBe(false);
    expect(orch.getEvents(original.taskId, 0).events.some((event) => event.text === "second prompt")).toBe(true);
  });

  it("injects the shipped orchestration guide only for cross-model requests", async () => {
    let prompt = "";
    const runner: PhaseRunner = { async *run(req) { prompt = req.prompt; yield { kind: "settled" }; } };
    const store = new MemoryTaskStore();
    const orch = new Orchestrator({ store, runner, netState: () => ({ offlineLocalOnly: true, remoteAuthorized: false }), workspaceRootFor: () => "/work/ws", orchestrationGuide: "USE ASTER DELEGATION TOOLS" });
    const task = orch.createTask({ title: "multi", defaultIdentity: IDENTITY }).task;
    orch.sendMessage({ taskId: task.taskId, text: "Build with OpenAI then audit with Claude" }); await orch.idle(task.taskId);
    expect(prompt).toContain("USE ASTER DELEGATION TOOLS");
    expect(prompt).toContain("Build with OpenAI then audit with Claude");
  });

  it("aggregates provider and model token usage from retained chats", async () => {
    const runner: PhaseRunner = { async *run() { yield { kind: "usage", input: 120, output: 30 }; yield { kind: "settled" }; } };
    const { orch } = make(runner);
    const task = orch.createTask({ title: "usage", defaultIdentity: IDENTITY }).task;
    orch.sendMessage({ taskId: task.taskId, text: "measure" }); await orch.idle(task.taskId);
    expect(orch.usageSummary().providers).toEqual([{ provider: "ollama", input: 120, output: 30, total: 150, models: [{ model: "llama3.1:8b", input: 120, output: 30, total: 150 }] }]);
  });
});
