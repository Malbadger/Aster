import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AntigravityPhaseRunner, GeminiCliPhaseRunner, ProviderPhaseRunner } from "./gemini-cli-runner.js";
import type { PhaseEvent, PhaseRunRequest, PhaseRunner } from "./phase-runner.js";

async function collect(runner: PhaseRunner, req: PhaseRunRequest): Promise<PhaseEvent[]> {
  const events: PhaseEvent[] = [];
  for await (const event of runner.run(req)) events.push(event);
  return events;
}

function request(taskId = "task-1"): PhaseRunRequest {
  return {
    taskId, identity: { provider: "gemini-cli", model: "gemini-cli:auto", effort: "medium" },
    prompt: "Inspect this workspace", tools: [], workspaceRoot: tmpdir(), allowMutation: false,
    gate: () => ({ allow: true, reason: "test" }), signal: new AbortController().signal,
  };
}

describe("GeminiCliPhaseRunner", () => {
  it("parses the official stream-json protocol and resumes a stable session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aster-gemini-runner-"));
    const argvLog = join(dir, "argv.jsonl");
    const script = join(dir, "gemini.js");
    writeFileSync(script, `
      const fs = require('node:fs');
      fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
      console.log(JSON.stringify({type:'message', role:'assistant', content:'Checked '}));
      console.log(JSON.stringify({type:'tool_use', tool_name:'read_file', tool_id:'t1', parameters:{path:'README.md'}}));
      console.log(JSON.stringify({type:'tool_result', tool_id:'t1', status:'success', output:'ok'}));
      console.log(JSON.stringify({type:'message', role:'assistant', content:'workspace.'}));
      console.log(JSON.stringify({type:'result', status:'success'}));
    `);
    const runner = new GeminiCliPhaseRunner(script);
    const first = await collect(runner, request());
    const second = await collect(runner, request());
    expect(first).toEqual([
      { kind: "tool_call", tool: "read_file", input: { path: "README.md" }, callId: "t1" },
      { kind: "tool_result", tool: "gemini-tool", ok: true, summary: "ok", callId: "t1" },
      { kind: "assistant", text: "Checked workspace." },
      { kind: "settled" },
    ]);
    expect(second.at(-1)).toEqual({ kind: "settled" });
    const invocations = (await import("node:fs")).readFileSync(argvLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(invocations[0]).toContain("--session-id");
    expect(invocations[1]).toContain("--resume");
    expect(invocations[0]).toContain("plan");
  });

  it("runs Antigravity JSONL with the selected model, effort, and permission mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aster-antigravity-runner-"));
    const argvLog = join(dir, "argv.json");
    const executable = join(dir, "agy");
    writeFileSync(executable, `#!/usr/bin/env node
      require('node:fs').writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));
      console.log(JSON.stringify({type:'init', conversation_id:'conversation-1'}));
      console.log(JSON.stringify({type:'step_update', step_type:'agent_response', text_delta:'Ready.'}));
      console.log(JSON.stringify({type:'result', status:'success'}));
    `);
    chmodSync(executable, 0o755);
    const req = { ...request("agy-task"), identity: { provider: "antigravity", model: "antigravity:gemini-code", effort: "high", mode: "auto" } as const };
    expect(await collect(new AntigravityPhaseRunner(executable), req)).toEqual([{ kind: "assistant", text: "Ready." }, { kind: "settled" }]);
    const args = JSON.parse(readFileSync(argvLog, "utf8")) as string[];
    expect(args).toEqual(expect.arrayContaining(["--model", "gemini-code", "--effort", "high", "--mode=accept-edits"]));
  });

  it("turns CLI failures into provider-neutral error events", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aster-gemini-error-"));
    const script = join(dir, "gemini.js");
    writeFileSync(script, "console.log(JSON.stringify({type:'error', severity:'error', message:'Login required'})); process.exitCode=2;\n");
    expect(await collect(new GeminiCliPhaseRunner(script), request("error-task"))).toEqual([{ kind: "error", message: "Login required" }]);
  });

  it("routes only Gemini CLI identities away from Pi", async () => {
    class Marker implements PhaseRunner { constructor(private label: string) {} async *run(): AsyncIterable<PhaseEvent> { yield { kind: "assistant", text: this.label }; } }
    const router = new ProviderPhaseRunner(new Marker("pi"), new Marker("gemini"));
    expect(await collect(router, request())).toEqual([{ kind: "assistant", text: "gemini" }]);
    expect(await collect(router, { ...request(), identity: { provider: "ollama", model: "qwen:latest", effort: "medium" } })).toEqual([{ kind: "assistant", text: "pi" }]);
  });
});
