import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { promptWithAttachments, type PhaseEvent, type PhaseRunRequest, type PhaseRunner } from "./phase-runner.js";

function sessionUuid(taskId: string): string {
  const hex = createHash("sha256").update(`aster:claude-code:${taskId}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/**
 * Transparent bridge to the user's official Claude Code installation.
 * Claude Code owns authentication, model access, sessions, and tool permission
 * prompts; Aster supplies the message and renders the structured reply.
 */
export class ClaudeCodePhaseRunner implements PhaseRunner {
  private readonly sessions = new Map<string, string>();
  private readonly orchestrationTasks = new Set<string>();

  constructor(
    private readonly executable = process.env.CLAUDE_CODE_PATH ?? "claude",
    private readonly mcpConfigPath?: string,
    private readonly mcpEnvironment: () => Record<string, string> = () => ({}),
  ) {}

  async *run(req: PhaseRunRequest): AsyncIterable<PhaseEvent> {
    const selected = req.identity.model.startsWith("anthropic:") ? req.identity.model.slice("anthropic:".length) : req.identity.model;
    const mode = req.identity.mode ?? "manual";
    const requestsDelegation = /aster_(?:list_models|delegate_start|delegate_get|delegate_wait)/i.test(req.prompt);
    if (requestsDelegation) this.orchestrationTasks.add(req.taskId);
    const delegation = requestsDelegation || this.orchestrationTasks.has(req.taskId);
    // Tool discovery is turn-specific and must not fork the provider session.
    // Identity, mode, effort, and workspace remain the actual session boundary.
    const binding = `${selected}\0${req.identity.effort}\0${mode}\0${req.workspaceRoot}`;
    const sessionId = sessionUuid(`${req.taskId}:${binding}`);
    const args = [
      "-p", promptWithAttachments(req, true),
      "--verbose", "--output-format", "stream-json",
      "--permission-mode", permissionMode(mode),
      "--effort", normalizeEffort(req.identity.effort),
    ];
    if (selected) args.push("--model", selected);
    if (this.mcpConfigPath && existsSync(this.mcpConfigPath)) args.push("--mcp-config", this.mcpConfigPath);
    if (delegation) {
      const tools = ["mcp__law-ollama__aster_list_models", "mcp__law-ollama__aster_delegate_start", "mcp__law-ollama__aster_delegate_get", "mcp__law-ollama__aster_delegate_wait"];
      if (req.identity.mode === "auto" || req.identity.mode === "full-access") tools.push("mcp__law-ollama__aster_delegate_start_mutating");
      args.push("--allowedTools", tools.join(","));
    }
    if (this.sessions.get(req.taskId) === binding) args.push("--resume", sessionId);
    else args.push("--session-id", sessionId);
    if (req.identity.mode === "full-access") args.push("--dangerously-skip-permissions");

    const child = spawn(this.executable, args, {
      cwd: req.workspaceRoot,
      env: { ...process.env, ...this.mcpEnvironment() },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exitPromise = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const onAbort = () => child.kill("SIGTERM");
    req.signal.addEventListener("abort", onAbort, { once: true });

    let assistant = "";
    let fatal: string | undefined;
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8_000); });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        let event: Record<string, any>;
        try { event = JSON.parse(line) as Record<string, any>; } catch { continue; }

        if (event.type === "system" && event.subtype === "init") this.sessions.set(req.taskId, binding);
        if (event.type === "assistant") {
          for (const block of contentBlocks(event.message?.content)) {
            if (block.type === "text") assistant += String(block.text ?? "");
            if (block.type === "tool_use") yield {
              kind: "tool_call", tool: String(block.name ?? "claude-code-tool"), input: block.input,
              callId: String(block.id ?? ""),
            };
          }
        }
        if (event.type === "user") {
          for (const block of contentBlocks(event.message?.content)) {
            if (block.type !== "tool_result") continue;
            yield {
              kind: "tool_result", tool: "claude-code-tool", ok: !block.is_error,
              summary: contentText(block.content), callId: String(block.tool_use_id ?? ""),
            };
          }
        }
        if (event.type === "result") {
          if (!assistant && typeof event.result === "string") assistant = event.result;
          if (event.is_error || event.subtype === "error_during_execution") fatal = String(event.result ?? event.error ?? "Claude Code run failed");
          const usage = event.usage;
          if (usage && typeof usage.input_tokens === "number" && typeof usage.output_tokens === "number") {
            yield { kind: "usage", input: usage.input_tokens, output: usage.output_tokens };
          }
        }
      }

      const exit = await exitPromise;
      if (req.signal.aborted) return;
      if (fatal || exit !== 0) {
        yield { kind: "error", message: fatal ?? (stderr.trim() || `Claude Code exited with code ${exit}`) };
        return;
      }
      if (assistant.trim()) yield { kind: "assistant", text: assistant.trim() };
      yield { kind: "settled" };
    } finally {
      req.signal.removeEventListener("abort", onAbort);
      lines.close();
    }
  }
}

function permissionMode(mode: string): "plan" | "manual" | "auto" | "bypassPermissions" {
  if (mode === "plan") return "plan";
  if (mode === "auto") return "auto";
  if (mode === "full-access") return "bypassPermissions";
  return "manual";
}

function normalizeEffort(effort: string): "low" | "medium" | "high" | "xhigh" {
  if (effort === "minimal" || effort === "low") return "low";
  if (effort === "max") return "xhigh";
  if (effort === "high") return "high";
  return "medium";
}

function contentBlocks(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, any> => Boolean(item && typeof item === "object")) : [];
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return String(value ?? "");
  return value.map((item) => typeof item === "string" ? item : item && typeof item === "object" && "text" in item ? String(item.text) : "").join("");
}
