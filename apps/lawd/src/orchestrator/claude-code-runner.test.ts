import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeCodePhaseRunner } from "./claude-code-runner.js";
import type { PhaseEvent, PhaseRunRequest } from "./phase-runner.js";

async function collect(runner: ClaudeCodePhaseRunner, req: PhaseRunRequest): Promise<PhaseEvent[]> {
  const events: PhaseEvent[] = [];
  for await (const event of runner.run(req)) events.push(event);
  return events;
}

function request(taskId = "claude-task", prompt = "Review this workspace", mode: PhaseRunRequest["identity"]["mode"] = "plan"): PhaseRunRequest {
  return {
    taskId,
    identity: { provider: "anthropic", model: "anthropic:claude-sonnet-4-6", effort: "medium", mode },
    prompt,
    tools: [],
    workspaceRoot: tmpdir(),
    allowMutation: false,
    gate: () => ({ allow: true, reason: "test" }),
    signal: new AbortController().signal,
  };
}

describe("ClaudeCodePhaseRunner", () => {
  it("passes messages through official Claude Code JSONL and resumes its session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aster-claude-code-"));
    const argvLog = join(dir, "argv.jsonl");
    const executable = join(dir, "claude");
    writeFileSync(executable, `#!/usr/bin/env node
      require('node:fs').appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
      const args = process.argv.slice(2); const id = args[args.indexOf('--session-id') + 1] || args[args.indexOf('--resume') + 1];
      console.log(JSON.stringify({type:'system', subtype:'init', session_id:id}));
      console.log(JSON.stringify({type:'assistant', message:{content:[{type:'tool_use', id:'tool-1', name:'Read', input:{file_path:'README.md'}},{type:'text', text:'Reviewed.'}]}}));
      console.log(JSON.stringify({type:'user', message:{content:[{type:'tool_result', tool_use_id:'tool-1', content:'ok'}]}}));
      console.log(JSON.stringify({type:'result', subtype:'success', is_error:false, result:'Reviewed.', usage:{input_tokens:12, output_tokens:3}}));
    `);
    chmodSync(executable, 0o755);
    const runner = new ClaudeCodePhaseRunner(executable);
    expect(await collect(runner, request())).toEqual([
      { kind: "tool_call", tool: "Read", input: { file_path: "README.md" }, callId: "tool-1" },
      { kind: "tool_result", tool: "claude-code-tool", ok: true, summary: "ok", callId: "tool-1" },
      { kind: "usage", input: 12, output: 3 },
      { kind: "assistant", text: "Reviewed." },
      { kind: "settled" },
    ]);
    await collect(runner, request());
    const calls = readFileSync(argvLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(calls[0]).toEqual(expect.arrayContaining(["--session-id", expect.any(String), "--permission-mode", "plan", "--model", "claude-sonnet-4-6"]));
    expect(calls[1]).toEqual(expect.arrayContaining(["--resume", expect.any(String)]));
  });

  it("shows Claude Code's exact provider failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aster-claude-code-error-"));
    const executable = join(dir, "claude");
    writeFileSync(executable, `#!/usr/bin/env node
      console.log(JSON.stringify({type:'system', subtype:'init', session_id:'session'}));
      console.log(JSON.stringify({type:'result', is_error:true, result:'This model requires usage credits.'}));
      process.exitCode = 1;
    `);
    chmodSync(executable, 0o755);
    expect(await collect(new ClaudeCodePhaseRunner(executable), request("error"))).toEqual([
      { kind: "error", message: "This model requires usage credits." },
    ]);
  });

  it("pre-authorizes only Aster's delegation tools for an orchestrated turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aster-claude-code-tools-"));
    const argvLog = join(dir, "argv.json"); const executable = join(dir, "claude");
    writeFileSync(executable, `#!/usr/bin/env node
      require('node:fs').writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));
      console.log(JSON.stringify({type:'system', subtype:'init'}));
      console.log(JSON.stringify({type:'result', is_error:false, result:'ok', usage:{input_tokens:1, output_tokens:1}}));
    `); chmodSync(executable, 0o755);
    await collect(new ClaudeCodePhaseRunner(executable), request("orchestration", "Use aster_delegate_start and aster_delegate_get"));
    const args = JSON.parse(readFileSync(argvLog, "utf8")) as string[];
    expect(args).toEqual(expect.arrayContaining(["--allowedTools", "mcp__law-ollama__aster_list_models,mcp__law-ollama__aster_delegate_start,mcp__law-ollama__aster_delegate_get"]));
  });

  it("pre-authorizes mutating delegation only in Auto or Full access", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aster-claude-code-mutating-tools-"));
    const argvLog = join(dir, "argv.json"); const executable = join(dir, "claude");
    writeFileSync(executable, `#!/usr/bin/env node
      require('node:fs').writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));
      console.log(JSON.stringify({type:'system', subtype:'init'}));
      console.log(JSON.stringify({type:'result', is_error:false, result:'ok', usage:{input_tokens:1, output_tokens:1}}));
    `); chmodSync(executable, 0o755);
    await collect(new ClaudeCodePhaseRunner(executable), request("orchestration-auto", "Use aster_delegate_start_mutating", "auto"));
    const args = JSON.parse(readFileSync(argvLog, "utf8")) as string[];
    expect(args).toEqual(expect.arrayContaining(["--permission-mode", "auto"]));
    expect(args).toEqual(expect.arrayContaining([
      "--allowedTools",
      "mcp__law-ollama__aster_list_models,mcp__law-ollama__aster_delegate_start,mcp__law-ollama__aster_delegate_get,mcp__law-ollama__aster_delegate_start_mutating",
    ]));
  });

  it("starts a new Claude session when the user changes execution mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aster-claude-code-mode-"));
    const argvLog = join(dir, "argv.jsonl"); const executable = join(dir, "claude");
    writeFileSync(executable, `#!/usr/bin/env node
      require('node:fs').appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
      console.log(JSON.stringify({type:'system', subtype:'init'}));
      console.log(JSON.stringify({type:'result', is_error:false, result:'ok', usage:{input_tokens:1, output_tokens:1}}));
    `); chmodSync(executable, 0o755);
    const runner = new ClaudeCodePhaseRunner(executable);
    await collect(runner, request("mode-change", "Review", "plan"));
    await collect(runner, request("mode-change", "Implement", "auto"));
    const calls = readFileSync(argvLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(calls[0]).toEqual(expect.arrayContaining(["--session-id", expect.any(String), "--permission-mode", "plan"]));
    expect(calls[1]).toEqual(expect.arrayContaining(["--session-id", expect.any(String), "--permission-mode", "auto"]));
    expect(calls[1]).not.toContain("--resume");
  });
});
