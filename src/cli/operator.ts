import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defaultLawConfig, findProfile, type LawConfig } from '../config/profiles.js';
import { Graph } from '../graph/graph.js';
import { readLatestCheckpoint, assertResumable, type CheckpointHashes } from '../graph/checkpoint.js';
import { makePiSessionNode } from '../graph/pi-session-node.js';
import { runGraph } from '../graph/runtime.js';
import { END, type RunState } from '../graph/types.js';
import { createPiAdapter, type PiAdapter } from '../pi-adapter/index.js';
import { RunAuthorization, type AuthorizationScope } from '../policy/authorization.js';
import { loginHandoff } from '../policy/login-handoff.js';
import { classifyRunMode } from '../policy/run-mode.js';
import type { CliIO } from './index.js';

const CONFIG_DIR = '.law';
const CONFIG_FILE = 'config.json';

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function configPath(cwd = process.cwd()): string {
  return join(cwd, CONFIG_DIR, CONFIG_FILE);
}

export function loadConfig(cwd = process.cwd()): LawConfig {
  const path = configPath(cwd);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as LawConfig) : defaultLawConfig();
}

export function runConfigureCommand(args: string[], io: CliIO): number {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const stable = option(args, '--stable-pi');
  if (stable) config.stablePi = stable;
  const path = configPath(cwd);
  mkdirSync(join(cwd, CONFIG_DIR), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  io.out(`CONFIGURED path=${path} profiles=${config.providerPolicies.map((p) => p.id).join(',')}`);
  return 0;
}

export function runProviderCommand(args: string[], io: CliIO): number {
  const [sub, id] = args;
  if (sub !== 'login' || !id) {
    io.err('usage: law provider login <ollama|chatgpt|claude-pro>');
    return 2;
  }
  const config = loadConfig();
  const profile = findProfile(config, id) ?? config.providerPolicies.find((p) => p.provider === id);
  if (!profile) {
    io.err(`provider profile "${id}" is not configured`);
    return 4;
  }
  const handoff = loginHandoff(profile.provider);
  io.out(`${handoff.message}\nNEXT (human-only): ${handoff.piLoginHint}`);
  return 0;
}

function makeWorkflow(
  prompt: string,
  profileId: string,
  model: string,
  workspace: string,
  allowMutation: boolean,
  scopes: AuthorizationScope[],
  adapter: PiAdapter = createPiAdapter(),
) {
  const config = loadConfig();
  const profile = findProfile(config, profileId);
  if (!profile) throw new Error(`unknown provider profile "${profileId}"`);
  const resolution = adapter.resolveProvider(profile, model);
  if (!resolution.ok) throw new Error(resolution.reason ?? 'provider/model denied');
  if (profile.provider !== 'ollama' && !scopes.includes('remote-provider')) {
    throw new Error('remote provider requires explicit --allow remote-provider; DATA LEAVES THIS MACHINE');
  }
  const graph = new Graph({ version: 'operator-v1', entry: 'agent_work', inputs: ['prompt'] });
  const node = makePiSessionNode({
    name: 'agent_work',
    reads: ['prompt'],
    writes: ['agentResult'],
    tools: allowMutation ? ['read', 'write', 'edit', 'bash'] : ['read', 'grep', 'find', 'ls'],
    adapter,
    profile,
    requestedModel: model,
    workspaceRoot: workspace,
    allowMutation,
    authorization: new RunAuthorization(scopes),
    resultKey: 'agentResult',
    brief: (reads) => String(reads.prompt ?? ''),
  });
  graph.addNode(node).addEdge('agent_work', END);
  return { graph, adapter, config, resolution };
}

function hashesFor(
  graphHash: string,
  config: unknown,
  adapterVersion: string,
  piVersion: string,
): CheckpointHashes {
  return { workflowHash: graphHash, configHash: hash(config), adapterVersion, piVersion };
}

export async function runWorkflowCommand(
  args: string[],
  io: CliIO,
  adapter: PiAdapter = createPiAdapter(),
): Promise<number> {
  const prompt = option(args, '--prompt');
  const workflow = option(args, '--workflow') ?? 'default';
  const profileId = option(args, '--provider') ?? 'ollama-local';
  const model = option(args, '--model');
  const workspace = resolve(option(args, '--workspace') ?? process.cwd());
  const mutation = args.includes('--mutate');
  const attended = !args.includes('--unattended');
  if (!prompt || !model) {
    io.err(
      'usage: law run --provider <profile> --model <model> --prompt <text> [--workspace <dir>] [--mutate] [--unattended]',
    );
    return 2;
  }
  const workflowPath = join(
    process.cwd(),
    'workflows',
    workflow.endsWith('.json') ? workflow : `${workflow}.json`,
  );
  if (!existsSync(workflowPath)) {
    io.err(`RUN BLOCKED: workflow not found: ${workflowPath}`);
    return 4;
  }
  const workflowSpec = JSON.parse(readFileSync(workflowPath, 'utf8')) as {
    schemaVersion?: number;
    entry?: string;
  };
  if (workflowSpec.schemaVersion !== 1 || workflowSpec.entry !== 'agent_work') {
    io.err(`RUN BLOCKED: invalid or unsupported workflow: ${workflowPath}`);
    return 4;
  }
  const workflowDigest = hash(workflowSpec);
  const caps = await adapter.capabilities();
  const mode = classifyRunMode({ attended, mutation, containerAvailable: caps.container.available });
  if (!mode.ok) {
    io.err(`RUN BLOCKED: ${mode.reason}`);
    return 4;
  }
  if (mode.mode === 'unattended-container') {
    io.err(
      'RUN BLOCKED: container execution must be launched by the container runner; host fallback is forbidden',
    );
    return 4;
  }
  const scopes = args
    .flatMap((v, i) => (v === '--allow' ? [args[i + 1] as AuthorizationScope] : []))
    .filter(Boolean);
  let built: ReturnType<typeof makeWorkflow>;
  try {
    built = makeWorkflow(prompt, profileId, model, workspace, mutation, scopes, adapter);
  } catch (e) {
    io.err(`RUN BLOCKED: ${e instanceof Error ? e.message : String(e)}`);
    return 4;
  }
  const liveCaps = await built.adapter.capabilities();
  const runConfig = { profileId, model, workspace, mutation, scopes, workflow, workflowDigest };
  const hashes = hashesFor(
    hash({ topology: built.graph.topologyHash(), workflowDigest }),
    { config: built.config, run: runConfig },
    built.adapter.adapterVersion,
    liveCaps.pi.version ?? 'missing',
  );
  const state = await runGraph(
    built.graph,
    { prompt, runConfig },
    { hashes, checkpointDir: join(process.cwd(), 'work', 'runs') },
  );
  io.out(
    `RUN ${state.status.toUpperCase()} run=${state.runId} provider=${built.resolution.observed?.provider} model=${built.resolution.observed?.model}`,
  );
  return state.status === 'completed' ? 0 : 4;
}

export async function runResumeCommand(args: string[], io: CliIO): Promise<number> {
  const runId = args[0];
  if (!runId) {
    io.err('usage: law resume <run-id> [--provider <same-profile>] [--model <same-model>]');
    return 2;
  }
  const cp = readLatestCheckpoint(join(process.cwd(), 'work', 'runs'), runId);
  if (!cp) {
    io.err(`resume refused: checkpoint not found for ${runId}`);
    return 4;
  }
  const prompt = String(cp.state.data.prompt ?? '');
  const locked = cp.state.data.runConfig as
    | {
        profileId: string;
        model: string;
        workspace: string;
        mutation: boolean;
        scopes: AuthorizationScope[];
        workflow: string;
        workflowDigest: string;
      }
    | undefined;
  if (!locked) {
    io.err('resume refused: checkpoint lacks immutable run configuration');
    return 4;
  }
  const workflowPath = join(
    process.cwd(),
    'workflows',
    locked.workflow.endsWith('.json') ? locked.workflow : `${locked.workflow}.json`,
  );
  if (
    !existsSync(workflowPath) ||
    hash(JSON.parse(readFileSync(workflowPath, 'utf8'))) !== locked.workflowDigest
  ) {
    io.err('resume refused: workflow hash mismatch');
    return 4;
  }
  const requestedProfile = option(args, '--provider');
  const requestedModel = option(args, '--model');
  if (
    (requestedProfile && requestedProfile !== locked.profileId) ||
    (requestedModel && requestedModel !== locked.model)
  ) {
    io.err(`resume refused: provider/model is immutable; locked ${locked.profileId}/${locked.model}`);
    return 4;
  }
  let built: ReturnType<typeof makeWorkflow>;
  try {
    built = makeWorkflow(
      prompt,
      locked.profileId,
      locked.model,
      locked.workspace,
      locked.mutation,
      locked.scopes,
    );
  } catch (e) {
    io.err(`resume refused: ${e instanceof Error ? e.message : String(e)}`);
    return 4;
  }
  const caps = await built.adapter.capabilities();
  const hashes = hashesFor(
    hash({ topology: built.graph.topologyHash(), workflowDigest: locked.workflowDigest }),
    { config: built.config, run: locked },
    built.adapter.adapterVersion,
    caps.pi.version ?? 'missing',
  );
  const decision = assertResumable(cp, hashes);
  if (!decision.ok) {
    io.err(`${decision.reason}\n${decision.mismatches.join('\n')}`);
    return 4;
  }
  if (cp.nextNode === END || cp.state.status === 'completed') {
    io.out(`RESUME NOOP run=${runId} already completed`);
    return 0;
  }
  const state = await runGraph(
    built.graph,
    { prompt },
    { hashes, checkpointDir: join(process.cwd(), 'work', 'runs') },
    cp.state as RunState,
  );
  io.out(`RESUME ${state.status.toUpperCase()} run=${runId}`);
  return state.status === 'completed' ? 0 : 4;
}
