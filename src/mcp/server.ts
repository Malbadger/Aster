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

async function startDelegation(input: { model: string; prompt: string; workspace: string; effort: 'minimal' | 'low' | 'medium' | 'high' | 'max'; mode: 'plan' | 'auto'; caller_model?: string; response_format: 'markdown' | 'json' }) {
  const { model, prompt, workspace, effort, mode, caller_model, response_format } = input;
  if (caller_model && caller_model === model) throw new Error('Refused recursive delegation to the calling model. Choose a different model.');
  const catalog = await callAsterDaemon<{ models: Array<{ id: string; displayName: string; provider: string; locality: 'local' | 'remote' | 'unknown'; availability: string; effort: { supported: string[] } }> }>('model_list_catalog', { query: model });
  const target = catalog.models.find((item) => item.id === model);
  if (!target) throw new Error(`Model "${model}" was not found. Call aster_list_models and use an exact ID.`);
  if (target.availability !== 'available') throw new Error(`Model "${model}" is ${target.availability}. Connect or sign in through Aster first.`);
  if (!target.effort.supported.includes(effort)) throw new Error(`Model "${model}" does not support effort "${effort}". Supported: ${target.effort.supported.join(', ')}.`);
  const identity = { provider: target.provider, model: target.id, effort, mode, locality: target.locality };
  const created = await callAsterDaemon<{ task: { taskId: string } }>('task_create', { title: `Delegated · ${target.displayName}`, workspaceId: workspace, defaultIdentity: identity });
  const sent = await callAsterDaemon<{ status: string }>('task_send_message', { taskId: created.task.taskId, text: prompt, identity, attachmentIds: [], attachmentEgressApproved: false });
  const output = { task_id: created.task.taskId, model: target.id, provider: target.provider, mode, status: sent.status };
  return textResult(output, response_format, `Started ${mode === 'plan' ? 'read-only ' : ''}Aster delegation **${created.task.taskId}** with **${target.id}**. Poll \`aster_delegate_get\` until it settles.`);
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
        const catalog = await callAsterDaemon<{ models: Array<{ id: string; displayName: string; provider: string; locality: string; availability: string }> }>('model_list_catalog', { query });
        const available = catalog.models.filter((model) => model.availability === 'available');
        return textResult(
          { count: available.length, models: available }, response_format,
          ['# Aster models', '', ...available.map((model) => `- **${model.id}** — ${model.displayName} (${model.provider}, ${model.locality})`)].join('\n'),
        );
      } catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'aster_delegate_start',
    {
      title: 'Delegate to an Aster Model',
      description: 'Starts a bounded read-only Aster task with an exact model ID. Safe in Plan mode. This is the supported way for one model to ask another to inspect, review, audit, or research; never use vendor SDKs, shell CLIs, credentials, or ad-hoc Python clients.',
      inputSchema: {
        model: z.string().min(1).max(300).describe('Exact provider-qualified ID from aster_list_models.'),
        prompt: z.string().min(1).max(30_000).describe('Self-contained task and expected return format.'),
        workspace: z.string().min(1).max(4_096).describe('Absolute workspace associated with the task.'),
        effort: z.enum(['minimal', 'low', 'medium', 'high', 'max']).default('medium'),
        mode: z.literal('plan').default('plan'),
        caller_model: z.string().max(300).optional().describe('Calling model ID; delegation to the same model is refused.'),
        response_format: formatSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ model, prompt, workspace, effort, mode, caller_model, response_format }) => {
      try { return await startDelegation({ model, prompt, workspace, effort, mode, ...(caller_model ? { caller_model } : {}), response_format }); }
      catch (error) { return errorResult(error); }
    },
  );

  server.registerTool(
    'aster_delegate_start_mutating',
    {
      title: 'Delegate Workspace Changes to an Aster Model',
      description: 'Starts a bounded Auto-mode Aster task that may modify the selected workspace. Use only when the user explicitly requested changes and the coordinating Aster phase is Auto or Full access.',
      inputSchema: {
        model: z.string().min(1).max(300), prompt: z.string().min(1).max(30_000), workspace: z.string().min(1).max(4_096),
        effort: z.enum(['minimal', 'low', 'medium', 'high', 'max']).default('medium'),
        caller_model: z.string().max(300).optional(), response_format: formatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ model, prompt, workspace, effort, caller_model, response_format }) => {
      try { return await startDelegation({ model, prompt, workspace, effort, mode: 'auto', ...(caller_model ? { caller_model } : {}), response_format }); }
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
        const result = await callAsterDaemon<{ events: Array<{ kind: string; text?: string; data?: Record<string, unknown> }>; taskStatus: string }>('task_get_events', { taskId: task_id, sinceSeq: 0 });
        const assistant = result.events.filter((event) => event.kind === 'assistant').at(-1);
        const error = result.events.filter((event) => event.kind === 'error').at(-1);
        const identity = assistant?.data?.identity as { provider?: string; model?: string } | undefined;
        const output = { task_id, status: result.taskStatus, provider: identity?.provider, model: identity?.model, response: assistant?.text, error: error?.text };
        const detail = error?.text ?? assistant?.text ?? 'The delegated model is still working.';
        return textResult(output, response_format, `# Delegation ${task_id}\n\n- Status: ${result.taskStatus}\n- Provider: ${identity?.provider ?? 'pending'}\n- Model: ${identity?.model ?? 'pending'}\n\n${detail}`);
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
