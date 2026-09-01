import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promptWithAttachments, type PhaseEvent, type PhaseRunRequest, type PhaseRunner } from './phase-runner.js';

function sessionUuid(taskId: string): string {
  const hex = createHash('sha256').update(`aster:gemini:${taskId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/** Runs the official Gemini CLI through its documented headless JSONL interface. */
export class GeminiCliPhaseRunner implements PhaseRunner {
  private readonly started = new Set<string>();
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(private readonly cliPath: string, private readonly nodePath = process.execPath) {}

  async *run(req: PhaseRunRequest): AsyncIterable<PhaseEvent> {
    const id = sessionUuid(req.taskId);
    const first = !this.started.has(req.taskId);
    const selected = req.identity.model.startsWith('gemini-cli:') ? req.identity.model.slice('gemini-cli:'.length) : req.identity.model;
    const args = [this.cliPath, '--output-format', 'stream-json', '--skip-trust', '--approval-mode', req.allowMutation ? 'auto_edit' : 'plan'];
    if (selected && selected !== 'auto') args.push('--model', selected);
    if (first) args.push('--session-id', id);
    else args.push('--resume', id);
    args.push('--prompt', promptWithAttachments(req, true));

    const child = spawn(this.nodePath, args, {
      cwd: req.workspaceRoot,
      env: { ...process.env, GOOGLE_GENAI_USE_GCA: 'true' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Attach lifecycle listeners immediately. A small/headless CLI can exit
    // before stdout iteration completes; listeners added afterward would miss
    // the close event and leave the phase waiting forever.
    const exitPromise = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    this.children.set(req.taskId, child);
    const onAbort = () => child.kill('SIGTERM');
    req.signal.addEventListener('abort', onAbort, { once: true });

    let assistant = '';
    let fatal: string | undefined;
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8_000); });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        let event: Record<string, any>;
        try { event = JSON.parse(line) as Record<string, any>; }
        catch { continue; }
        if (event.type === 'message' && event.role === 'assistant') assistant += String(event.content ?? '');
        if (event.type === 'tool_use') yield { kind: 'tool_call', tool: String(event.tool_name ?? 'gemini-tool'), input: event.parameters, callId: String(event.tool_id ?? '') };
        if (event.type === 'tool_result') yield { kind: 'tool_result', tool: 'gemini-tool', ok: event.status !== 'error', summary: String(event.output ?? event.error?.message ?? event.status ?? ''), callId: String(event.tool_id ?? '') };
        if (event.type === 'error' && event.severity === 'error') fatal = String(event.message ?? 'Gemini CLI error');
        if (event.type === 'result' && event.status === 'error') fatal = String(event.error?.message ?? 'Gemini CLI run failed');
      }
      const exit = await exitPromise;
      if (req.signal.aborted) return;
      if (assistant.trim()) yield { kind: 'assistant', text: assistant.trim() };
      if (fatal || exit !== 0) {
        yield { kind: 'error', message: fatal ?? (stderr.trim() || `Gemini CLI exited with code ${exit}`) };
        return;
      }
      this.started.add(req.taskId);
      yield { kind: 'settled' };
    } finally {
      req.signal.removeEventListener('abort', onAbort);
      this.children.delete(req.taskId);
      lines.close();
    }
  }
}

/** Runs Google's supported Antigravity CLI for individual Google accounts. */
export class AntigravityPhaseRunner implements PhaseRunner {
  private readonly conversations = new Map<string, string>();
  constructor(private readonly executable = 'agy') {}

  async *run(req: PhaseRunRequest): AsyncIterable<PhaseEvent> {
    const selected = req.identity.model.startsWith('antigravity:') ? req.identity.model.slice('antigravity:'.length) : req.identity.model;
    const args = ['-p', promptWithAttachments(req, true), '--output-format', 'stream-json'];
    if (selected && selected !== 'auto') args.push('--model', selected);
    // Antigravity's concrete catalog IDs already encode effort (for example
    // gemini-3.6-flash-low). Passing --effort as well is rejected by the CLI.
    if (!selected || selected === 'auto' || !modelEncodesEffort(selected)) args.push('--effort', normalizeEffort(req.identity.effort));
    const prior = this.conversations.get(req.taskId);
    if (prior) args.push('--conversation', prior);
    const mode = req.identity.mode ?? 'manual';
    if (mode === 'plan') args.push('--mode=plan');
    if (mode === 'auto') args.push('--mode=accept-edits');
    if (mode === 'full-access') args.push('--mode=accept-edits', '--dangerously-skip-permissions');

    const child = spawn(this.executable, args, { cwd: req.workspaceRoot, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const exitPromise = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    const onAbort = () => child.kill('SIGTERM');
    req.signal.addEventListener('abort', onAbort, { once: true });
    let assistant = '';
    let stderr = '';
    let fatal: string | undefined;
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8_000); });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        let event: Record<string, any>;
        try { event = JSON.parse(line) as Record<string, any>; } catch { continue; }
        // Current Antigravity JSONL wraps payloads under their event name;
        // accept the older flat shape as well so upgrades remain compatible.
        const eventType = event.event ?? event.type;
        const step = event.step_update ?? event;
        const result = event.result ?? event;
        const conversationId = event.conversation_id ?? event.conversationId ?? event.init?.conversation_id ?? step.conversation_id ?? result.conversation_id;
        if (typeof conversationId === 'string') this.conversations.set(req.taskId, conversationId);
        if (eventType === 'step_update' && step.step_type === 'agent_response') assistant += String(step.text_delta ?? step.text ?? '');
        if (eventType === 'step_update' && step.step_type === 'tool_call') yield { kind: 'tool_call', tool: String(step.tool_name ?? step.name ?? 'antigravity-tool'), input: step.parameters ?? step.input, callId: String(step.tool_call_id ?? step.id ?? '') };
        if (eventType === 'step_update' && step.step_type === 'tool_result') yield { kind: 'tool_result', tool: String(step.tool_name ?? 'antigravity-tool'), ok: !step.error, summary: String(step.output ?? step.error ?? ''), callId: String(step.tool_call_id ?? step.id ?? '') };
        if (eventType === 'result' && String(result.status).toLowerCase() === 'error') fatal = errorMessage(result.error) ?? String(result.message ?? 'Antigravity CLI run failed');
        if (eventType === 'result' && !assistant && typeof result.response === 'string') assistant = result.response;
      }
      const exit = await exitPromise;
      if (req.signal.aborted) return;
      if (assistant.trim()) yield { kind: 'assistant', text: assistant.trim() };
      if (fatal || exit !== 0) { yield { kind: 'error', message: fatal ?? (stderr.trim() || `Antigravity CLI exited with code ${exit}`) }; return; }
      yield { kind: 'settled' };
    } finally {
      req.signal.removeEventListener('abort', onAbort); lines.close();
    }
  }
}

function normalizeEffort(effort: string): 'low' | 'medium' | 'high' {
  if (effort === 'minimal' || effort === 'low') return 'low';
  if (effort === 'max' || effort === 'high') return 'high';
  return 'medium';
}

function modelEncodesEffort(model: string): boolean { return /-(?:low|medium|high|xhigh|max)$/i.test(model); }

function errorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return undefined;
}

/** Routes a phase to a provider-specific runner without leaking that choice into graph state. */
export class ProviderPhaseRunner implements PhaseRunner {
  constructor(
    private readonly pi: PhaseRunner,
    private readonly gemini: PhaseRunner,
    private readonly antigravity: PhaseRunner = gemini,
    private readonly claudeCode: PhaseRunner = pi,
  ) {}
  run(req: PhaseRunRequest): AsyncIterable<PhaseEvent> {
    return (
      req.identity.provider === 'gemini-cli' ? this.gemini
      : req.identity.provider === 'antigravity' ? this.antigravity
      : req.identity.provider === 'anthropic' ? this.claudeCode
      : this.pi
    ).run(req);
  }
}
