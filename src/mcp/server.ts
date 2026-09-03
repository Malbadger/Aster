#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import {
  exportLocalEvidence,
  getLocalJob,
  getLocalRun,
  getSelectedModel,
  listOllamaModels,
  startLocalReadOnlyJob,
  selectOllamaModel,
} from './local-service.js';
import { callAsterDaemon } from './daemon-client.js';
import { delegationMarkdown, summarizeDelegation, waitForDelegation, type DelegationEventsResult } from './delegation.js';
import { assertDelegationCaller } from './caller-identity.js';

const LAW_ROOT = process.env.LAW_PROJECT_ROOT ?? fileURLToPath(new URL('../..', import.meta.url));
const RESPONSE_LIMIT = 12_000;
const formatSchema = z.enum(['markdown', 'json']).default('markdown');

function textResult(output: Record<string, unknown>, format: 'markdown' | 'json', markdown: string) {
  const rendered = format === 'json' ? JSON.stringify(output, null, 2) : markdown;
  return {
    content: [{ type: 'text' as const, text: rendered.slice(0, RESPONSE_LIMIT) }],
    structuredContent: output,
  };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `Aster local MCP error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
  };
}

async function resolveWorkspace(requested?: string): Promise<string> {
  const active = await callAsterDaemon<{ path?: string }>('workspace_get_root', {});
  if (!active.path) throw new Error('No active Aster workspace. Open a folder in Aster before delegating.');
  const current = realpathSync(active.path);
  if (/^\/tmp\/(?:\.mount_Aster\.|appimage_extracted_)/.test(current)) throw new Error('Aster refused its internal AppImage runtime as a workspace. Open a real folder first.');
  if (requested) {
    const candidate = realpathSync(requested);
    if (candidate !== current) throw new Error(`Requested workspace "${candidate}" does not match Aster's active workspace "${current}".`);
  }
  return current;
}

async function startDelegation(input: { model?: string; provider?: string; prompt: string; workspace?: string; effort: 'minimal' | 'low' | 'medium' | 'high' | 'max'; mode: 'plan' | 'auto' | 'full-access'; caller_model?: string; response_format: 'markdown' | 'json' }) {
  const { model, provider, prompt, workspace, effort, mode, caller_model, response_format } = input;
  if (!model && !provider) throw new Error('Provide an exact model ID or a provider with a configured default.');
  const resolved = await callAsterDaemon<{ model: { id: string; displayName: string; provider: string; locality: 'local' | 'remote' | 'unknown'; availability: string; effort: { supported: string[] } }; source: 'explicit' | 'provider-default' }>('model_resolve_target', { ...(model ? { modelId: model } : {}), ...(provider ? { provider } : {}) });
  const target = resolved.model;
  const activeWorkspace = await resolveWorkspace(workspace);
  const effectiveCaller = assertDelegationCaller(target.id, caller_model);
  if (!target.effort.supported.includes(effort)) throw new Error(`Model "${target.id}" does not support effort "${effort}". Supported: ${target.effort.supported.join(', ')}.`);
  const identity = { provider: target.provider, model: target.id, effort, mode, locality: target.locality };
  const created = await callAsterDaemon<{ task: { taskId: string } }>('task_create', { title: `Delegated · ${target.displayName}`, workspaceId: activeWorkspace, defaultIdentity: identity });
  const sent = await callAsterDaemon<{ status: string }>('task_send_message', { taskId: created.task.taskId, text: prompt, identity, attachmentIds: [], attachmentEgressApproved: false });
  const output = { task_id: created.task.taskId, model: target.id, provider: target.provider, resolution: resolved.source, caller_model: effectiveCaller ?? null, mode, status: sent.status };
  return textResult(output, response_format, `Started ${mode === 'plan' ? 'read-only ' : ''}Aster delegation **${created.task.taskId}** with **${target.id}** (${resolved.source}, mode ${mode}). Call \`aster_delegate_wait\` with this task ID.`);
}

export function createLawMcpServer(): McpServer {
  const server = new McpServer({ name: 'law-mcp-server', version: '0.1.0' });

  server.registerTool(
    'aster_list_models',
    {
      title: 'List Aster Models',
      description: 'Lists every model currently available through Aster, including its exact provider-qualified ID. Use this before delegating; never search the workspace for vendor SDKs or credential files.',
      inputSchema: { query: z.string().max(200).default(''), response_format: formatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, response_format }) => {
      try {
        const catalog = await callAsterDaemon<{ models: Array<{ id: string; displayName: string; provider: string; locality: string; availability: string }>; defaults: Record<string, string> }>('model_list_catalog', { query });
        const available = catalog.models.filter((model) => model.availability === 'available');
        return textResult(
          { count: available.length, defaults: catalog.defaults, models: available }, response_format,
          ['# Aster models', '', ...available.map((model) => `- **${model.id}** — ${model.displayName} (${model.provider}, ${model.locality})${catalog.defaults[model.provider] === model.id ? ' · default' : ''}`)].join('\n'),
        );
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'aster_delegate_start',
    {
      title: 'Delegate to an Aster Model',
      description: 'Starts a bounded read-only Aster task using an exact model ID or a configured provider default. Safe in Plan mode. Never substitutes another model.',
      inputSchema: {
        model: z.string().min(1).max(300).optional().describe('Exact provider-qualified ID from aster_list_models. Takes precedence over provider default.'),
        provider: z.string().min(1).max(200).optional().describe('Provider whose configured default should be used when model is omitted.'),
        prompt: z.string().min(1).max(30_000).describe('Self-contained task and expected return format.'),
        workspace: z.string().min(1).max(4_096).optional().describe("Optional active Aster workspace. If supplied, it must exactly match Aster's selected workspace."),
        effort: z.enum(['minimal', 'low', 'medium', 'high', 'max']).default('medium'),
        mode: z.literal('plan').default('plan'),
        caller_model: z.string().max(300).optional().describe('Calling model ID; delegation to the same model is refused.'),
        response_format: formatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ model, provider, prompt, workspace, effort, mode, caller_model, response_format }) => {
      try { return await startDelegation({ ...(model ? { model } : {}), ...(provider ? { provider } : {}), prompt, workspace, effort, mode, ...(caller_model ? { caller_model } : {}), response_format }); }
      catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'aster_delegate_start_mutating',
    {
      title: 'Delegate Workspace Changes to an Aster Model',
      description: 'Starts a bounded Auto or Full Access Aster task that may modify the selected workspace. The required mode must match the coordinating Aster phase.',
      inputSchema: {
        model: z.string().min(1).max(300).optional(), provider: z.string().min(1).max(200).optional(), prompt: z.string().min(1).max(30_000), workspace: z.string().min(1).max(4_096).optional(),
        effort: z.enum(['minimal', 'low', 'medium', 'high', 'max']).default('medium'),
        mode: z.enum(['auto', 'full-access']).describe('Must match the coordinating Aster phase mode.'),
        caller_model: z.string().max(300).optional(), response_format: formatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ model, provider, prompt, workspace, effort, mode, caller_model, response_format }) => {
      try { return await startDelegation({ ...(model ? { model } : {}), ...(provider ? { provider } : {}), prompt, ...(workspace ? { workspace } : {}), effort, mode, ...(caller_model ? { caller_model } : {}), response_format }); }
      catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'aster_delegate_get',
    {
      title: 'Get Aster Delegation',
      description: 'Polls an Aster delegation and returns its provider-labelled final response or exact error. Poll until status is not active.',
      inputSchema: { task_id: z.string().min(1).max(200), response_format: formatSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ task_id, response_format }) => {
      try {
        const result = await callAsterDaemon<DelegationEventsResult>('task_get_events', { taskId: task_id, sinceSeq: 0 });
        const output = summarizeDelegation(task_id, result);
        return textResult(output as unknown as Record<string, unknown>, response_format, delegationMarkdown(output));
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'aster_delegate_wait',
    {
      title: 'Wait for Aster Delegation',
      description: 'Waits natively for an existing delegated task to settle. Use this instead of Bash sleeps, timers, Monitor, or repeated tight polling. Safe to call again with the same task ID after timeout or follow-up.',
      inputSchema: {
        task_id: z.string().min(1).max(200),
        timeout_ms: z.number().int().min(1_000).max(900_000).default(300_000),
        poll_interval_ms: z.number().int().min(250).max(10_000).default(1_500),
        response_format: formatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ task_id, timeout_ms, poll_interval_ms, response_format }) => {
      try {
        const output = await waitForDelegation(task_id, timeout_ms, poll_interval_ms, () =>
          callAsterDaemon<DelegationEventsResult>('task_get_events', { taskId: task_id, sinceSeq: 0 }));
        return textResult(output as unknown as Record<string, unknown>, response_format, delegationMarkdown(output));
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'law_ollama_list_models',
    {
      title: 'List Local Ollama Models',
      description:
        'Lists models installed in the Ollama service on this device. This contacts only the loopback Ollama endpoint and does not call a cloud provider.',
      inputSchema: {
        response_format: formatSchema.describe('Human-readable markdown or complete JSON.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ response_format }) => {
      try {
        const models = await listOllamaModels();
        const selected = getSelectedModel(LAW_ROOT)?.model ?? null;
        const output = { count: models.length, selected, models };
        const lines = [`# Local Ollama models`, '', `Selected: ${selected ?? 'none'}`, ''];
        for (const model of models) {
          lines.push(`- ${model.name}${model.name === selected ? ' (selected)' : ''}`);
        }
        return textResult(output, response_format, lines.join('\n'));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'law_ollama_select_model',
    {
      title: 'Select Local Ollama Model',
      description:
        'Selects one installed Ollama model as the default for future Aster MCP runs. Selection applies to new runs only; an existing run keeps its original provider and model lock.',
      inputSchema: {
        model: z.string().min(1).max(200).describe('Exact model name returned by list models.'),
        response_format: formatSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ model, response_format }) => {
      try {
        const selection = await selectOllamaModel(LAW_ROOT, model);
        return textResult(
          selection as unknown as Record<string, unknown>,
          response_format,
          `Selected local Ollama model **${selection.model}** for new Aster runs.`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'law_ollama_get_selection',
    {
      title: 'Get Selected Local Model',
      description: 'Returns the Ollama model currently selected for new Aster MCP runs.',
      inputSchema: { response_format: formatSchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ response_format }) => {
      const selection = getSelectedModel(LAW_ROOT);
      const output = { selected: selection };
      return textResult(
        output,
        response_format,
        selection ? `Selected model: **${selection.model}**` : 'No Ollama model is selected.',
      );
    },
  );

  server.registerTool(
    'law_ollama_start_readonly',
    {
      title: 'Start Read-Only Local Ollama Job',
      description:
        'Starts a background, bounded, read-only Aster/Pi job using Ollama on this device and immediately returns a job ID. Poll law_ollama_get_job for its compact result. The worker cannot write, edit, or execute shell commands.',
      inputSchema: {
        prompt: z.string().min(1).max(20_000).describe('Clear bounded task for the local worker.'),
        workspace: z.string().min(1).max(4_096).describe('Absolute workspace directory to inspect.'),
        model: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe('Optional one-run override; otherwise uses the selected model.'),
        response_format: formatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ prompt, workspace, model, response_format }) => {
      try {
        const job = startLocalReadOnlyJob(LAW_ROOT, { prompt, workspace, model });
        return textResult(
          job as unknown as Record<string, unknown>,
          response_format,
          `Started local job **${job.job_id}** with **${job.model}**. Poll law_ollama_get_job for status and result.`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'law_ollama_get_job',
    {
      title: 'Get Local Ollama Job',
      description: 'Returns status and, when complete, the compact Aster result for a background local Ollama job.',
      inputSchema: {
        job_id: z.string().regex(/^job-[a-zA-Z0-9_-]+$/),
        response_format: formatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ job_id, response_format }) => {
      try {
        const job = getLocalJob(LAW_ROOT, job_id);
        const detail = job.run?.summary?.text ?? job.message ?? 'Local worker is still running.';
        return textResult(
          job as unknown as Record<string, unknown>,
          response_format,
          `# Local job ${job.job_id}\n\n- Status: ${job.status}\n- Model: ${job.model}\n\n${detail}`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'law_ollama_get_run',
    {
      title: 'Get Local Aster Run',
      description:
        'Reads the latest local checkpoint and compact result for a prior Aster/Ollama run. It does not load the full Pi transcript.',
      inputSchema: {
        run_id: z.string().regex(/^run-[a-zA-Z0-9_-]+$/),
        response_format: formatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ run_id, response_format }) => {
      try {
        const run = getLocalRun(LAW_ROOT, run_id);
        return textResult(
          run as unknown as Record<string, unknown>,
          response_format,
          `# Aster run ${run.run_id}\n\n- Status: ${run.status}\n- Model: ${run.model}\n- Workspace: ${run.workspace}\n\n${run.summary?.text ?? '(no summary)'}`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'law_ollama_export_evidence',
    {
      title: 'Export Local Aster Evidence',
      description:
        'Creates a redacted local evidence bundle for an existing Aster run and returns its local path and SHA-256 digest.',
      inputSchema: {
        run_id: z.string().regex(/^run-[a-zA-Z0-9_-]+$/),
        response_format: formatSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ run_id, response_format }) => {
      try {
        const evidence = exportLocalEvidence(LAW_ROOT, run_id);
        return textResult(
          evidence,
          response_format,
          `Evidence exported locally:\n\n- Path: ${evidence.path}\n- SHA-256: ${evidence.sha256}`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createLawMcpServer();
  await server.connect(new StdioServerTransport());
  console.error(`Aster MCP server ready (local stdio, root=${LAW_ROOT})`);
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  runStdioServer().catch((error) => {
    console.error(`Aster MCP fatal: ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(1);
  });
}
