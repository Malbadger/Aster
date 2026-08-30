import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runEvidenceCommand } from '../cli/evidence.js';
import type { CliIO } from '../cli/index.js';
import { runWorkflowCommand } from '../cli/operator.js';
import { readLatestCheckpoint } from '../graph/checkpoint.js';
import type { PiSessionSummary } from '../graph/pi-session-node.js';

const OLLAMA_TAGS_URL = 'http://127.0.0.1:11434/api/tags';
const SELECTION_FILE = 'mcp-selection.json';

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  family?: string;
  parameter_size?: string;
  quantization_level?: string;
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    size?: number;
    modified_at?: string;
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

export interface SelectedModel {
  model: string;
  selected_at: string;
}

function selectionPath(lawRoot: string): string {
  return join(lawRoot, '.law', SELECTION_FILE);
}

export async function listOllamaModels(
  fetcher: typeof fetch = fetch,
): Promise<OllamaModel[]> {
  let response: Response;
  try {
    response = await fetcher(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(
      `Ollama is not reachable on 127.0.0.1:11434. Start Ollama and try again (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!response.ok) {
    throw new Error(`Ollama model query failed with HTTP ${response.status}.`);
  }
  const body = (await response.json()) as OllamaTagsResponse;
  return (body.models ?? [])
    .filter((model): model is NonNullable<typeof model> & { name: string } => Boolean(model.name))
    .map((model) => ({
      name: model.name,
      size: model.size ?? 0,
      modified_at: model.modified_at ?? '',
      ...(model.details?.family ? { family: model.details.family } : {}),
      ...(model.details?.parameter_size ? { parameter_size: model.details.parameter_size } : {}),
      ...(model.details?.quantization_level
        ? { quantization_level: model.details.quantization_level }
        : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getSelectedModel(lawRoot: string): SelectedModel | null {
  const path = selectionPath(lawRoot);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as SelectedModel;
    return typeof value.model === 'string' && typeof value.selected_at === 'string' ? value : null;
  } catch {
    return null;
  }
}

export async function selectOllamaModel(
  lawRoot: string,
  model: string,
  fetcher: typeof fetch = fetch,
): Promise<SelectedModel> {
  const installed = await listOllamaModels(fetcher);
  if (!installed.some((item) => item.name === model)) {
    throw new Error(
      `Model "${model}" is not installed in Ollama. Choose one returned by law_ollama_list_models.`,
    );
  }
  const selection = { model, selected_at: new Date().toISOString() };
  const dir = join(lawRoot, '.law');
  const path = selectionPath(lawRoot);
  const temporary = `${path}.tmp`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(selection, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  return selection;
}

function captureIO(): { io: CliIO; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { out: (line) => stdout.push(line), err: (line) => stderr.push(line) },
  };
}

export interface LocalRunResult {
  run_id: string;
  status: string;
  model: string;
  workspace: string;
  summary: PiSessionSummary | null;
}

export interface LocalJob {
  job_id: string;
  model: string;
  workspace: string;
  created_at: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  run?: LocalRunResult;
  message?: string;
}

let jobQueue: Promise<void> = Promise.resolve();

function jobDir(lawRoot: string): string {
  return join(lawRoot, '.law', 'mcp-jobs');
}

function jobPath(lawRoot: string, jobId: string): string {
  return join(jobDir(lawRoot), `${jobId}.json`);
}

export function startLocalReadOnlyJob(
  lawRoot: string,
  input: { prompt: string; workspace: string; model?: string },
): LocalJob {
  const selected = input.model ?? getSelectedModel(lawRoot)?.model;
  if (!selected) throw new Error('No Ollama model selected. Call law_ollama_select_model first or pass model.');
  const workspace = resolve(input.workspace);
  if (!existsSync(workspace)) throw new Error(`Workspace does not exist: ${workspace}`);
  const jobId = `job-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const dir = jobDir(lawRoot);
  mkdirSync(dir, { recursive: true });
  const job: LocalJob = {
    job_id: jobId,
    model: selected,
    workspace,
    created_at: new Date().toISOString(),
    status: 'queued',
  };
  writeFileSync(jobPath(lawRoot, jobId), `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
  jobQueue = jobQueue.then(async () => {
    const running = { ...job, status: 'running' as const };
    writeFileSync(jobPath(lawRoot, jobId), `${JSON.stringify(running, null, 2)}\n`, { mode: 0o600 });
    try {
      const run = await runLocalReadOnly(lawRoot, { prompt: input.prompt, workspace, model: selected });
      const finished: LocalJob = {
        ...job,
        status: run.status === 'completed' ? 'completed' : 'failed',
        run,
      };
      writeFileSync(jobPath(lawRoot, jobId), `${JSON.stringify(finished, null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      const failed: LocalJob = {
        ...job,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
      writeFileSync(jobPath(lawRoot, jobId), `${JSON.stringify(failed, null, 2)}\n`, { mode: 0o600 });
    }
  });
  return job;
}

export function getLocalJob(
  lawRoot: string,
  jobId: string,
): LocalJob {
  const path = jobPath(lawRoot, jobId);
  if (!existsSync(path)) throw new Error(`No local LAW job found for ${jobId}.`);
  return JSON.parse(readFileSync(path, 'utf8')) as LocalJob;
}

export async function runLocalReadOnly(
  lawRoot: string,
  input: { prompt: string; workspace: string; model?: string },
): Promise<LocalRunResult> {
  const selected = input.model ?? getSelectedModel(lawRoot)?.model;
  if (!selected) {
    throw new Error('No Ollama model selected. Call law_ollama_select_model first or pass model.');
  }
  const workspace = resolve(input.workspace);
  if (!existsSync(workspace)) throw new Error(`Workspace does not exist: ${workspace}`);
  const capture = captureIO();
  const originalCwd = process.cwd();
  try {
    process.chdir(lawRoot);
    const code = await runWorkflowCommand(
      [
        '--workflow',
        'default',
        '--provider',
        'ollama-local',
        '--model',
        selected,
        '--workspace',
        workspace,
        '--prompt',
        input.prompt,
      ],
      capture.io,
    );
    const output = [...capture.stdout, ...capture.stderr].join('\n');
    const runId = /\brun=(run-[a-zA-Z0-9_-]+)/.exec(output)?.[1];
    if (code !== 0 || !runId) throw new Error(output || `LAW run failed with exit code ${code}.`);
    return getLocalRun(lawRoot, runId);
  } finally {
    process.chdir(originalCwd);
  }
}

export function getLocalRun(lawRoot: string, runId: string): LocalRunResult {
  const checkpoint = readLatestCheckpoint(join(lawRoot, 'work', 'runs'), runId);
  if (!checkpoint) throw new Error(`No LAW checkpoint found for run ${runId}.`);
  const config = checkpoint.state.data.runConfig as
    | { model?: string; workspace?: string }
    | undefined;
  const nodeResult = checkpoint.state.results.agent_work;
  const summary = (checkpoint.state.data.agentResult ?? nodeResult?.summary ?? null) as PiSessionSummary | null;
  const status =
    checkpoint.state.status === 'running' && checkpoint.nextNode === '__end__'
      ? nodeResult?.status === 'ok'
        ? 'completed'
        : nodeResult?.status === 'error' || nodeResult?.status === 'invalid_output'
          ? 'failed'
          : (nodeResult?.status ?? 'running')
      : checkpoint.state.status;
  return {
    run_id: runId,
    status,
    model: config?.model ?? 'unknown',
    workspace: config?.workspace ?? 'unknown',
    summary,
  };
}

export function exportLocalEvidence(
  lawRoot: string,
  runId: string,
): { run_id: string; path: string; sha256: string } {
  // Refuse exports for unknown runs instead of manufacturing an unrelated bundle.
  getLocalRun(lawRoot, runId);
  const capture = captureIO();
  const originalCwd = process.cwd();
  try {
    process.chdir(lawRoot);
    const code = runEvidenceCommand(['export', runId], capture.io);
    const output = [...capture.stdout, ...capture.stderr].join('\n');
    if (code !== 0) throw new Error(output || `Evidence export failed with exit code ${code}.`);
    const path = /\bpath=(\S+)/.exec(output)?.[1];
    const sha256 = /\bsha256=([a-f0-9]{64})/.exec(output)?.[1];
    if (!path || !sha256) throw new Error('Evidence export did not return a path and digest.');
    return { run_id: runId, path, sha256 };
  } finally {
    process.chdir(originalCwd);
  }
}
