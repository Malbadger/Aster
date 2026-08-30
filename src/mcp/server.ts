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
        text: `LAW local MCP error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
  };
}

export function createLawMcpServer(): McpServer {
  const server = new McpServer({ name: 'law-mcp-server', version: '0.1.0' });

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
        'Selects one installed Ollama model as the default for future LAW MCP runs. Selection applies to new runs only; an existing run keeps its original provider and model lock.',
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
          `Selected local Ollama model **${selection.model}** for new LAW runs.`,
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
      description: 'Returns the Ollama model currently selected for new LAW MCP runs.',
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
        'Starts a background, bounded, read-only LAW/Pi job using Ollama on this device and immediately returns a job ID. Poll law_ollama_get_job for its compact result. The worker cannot write, edit, or execute shell commands.',
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
      description: 'Returns status and, when complete, the compact LAW result for a background local Ollama job.',
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
      title: 'Get Local LAW Run',
      description:
        'Reads the latest local checkpoint and compact result for a prior LAW/Ollama run. It does not load the full Pi transcript.',
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
          `# LAW run ${run.run_id}\n\n- Status: ${run.status}\n- Model: ${run.model}\n- Workspace: ${run.workspace}\n\n${run.summary?.text ?? '(no summary)'}`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'law_ollama_export_evidence',
    {
      title: 'Export Local LAW Evidence',
      description:
        'Creates a redacted local evidence bundle for an existing LAW run and returns its local path and SHA-256 digest.',
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
  console.error(`LAW MCP server ready (local stdio, root=${LAW_ROOT})`);
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
    console.error(`LAW MCP fatal: ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(1);
  });
}
