/**
 * Aster daemon (lawd).
 *
 * Owns the contract registry, the dispatcher, and the socket server. Registers
 * the operation handlers for its current phase and reports which contracted
 * operations still lack a handler (so a census can prove coverage as phases
 * land). Health and the capability probe are wired here (BUILD-D-003).
 */
import {
  createContractRegistry,
  daemon_get_health,
  daemon_probe_capabilities,
  model_list_catalog,
  model_set_favorite,
  model_resolve_effort,
  provider_list_connections,
  provider_add_connection,
  provider_remove_connection,
  provider_set_enabled,
  provider_check_credential,
  provider_auth_methods, provider_auth_start, provider_auth_get, provider_auth_respond, provider_auth_cancel, provider_auth_logout, provider_gemini_cli_status,
  net_check_endpoint,
  task_create,
  task_list,
  task_get,
  task_send_message,
  task_get_events,
  task_cancel,
  task_delete,
  fs_read_file,
  fs_write_file,
  verify_run,
  verify_get_status,
  autocomplete_get_config,
  autocomplete_set_config,
  autocomplete_complete,
  git_status,
  git_stage,
  git_commit,
  git_create_branch,
  git_remote_action,
  log_get_policy,
  log_set_policy,
  evidence_export,
  update_check,
  update_stage,
  migration_status,
  migration_run,
  plugin_list,
  about_get,
  workspace_get_root,
  workspace_set_root,
  type EffortLevel,
  type AddConnectionInput,
  type PhaseIdentity,
  type AutocompleteConfig,
  type RemoteEffect,
  type RemoteConfirmation,
  type PluginManifest,
} from "@law/contracts";
import { Dispatcher, LawdSocketServer } from "./ipc/server.js";
import { writeHandshake, clearHandshake, newToken, defaultSocketPath } from "./ipc/handshake.js";
import { buildHealth } from "./health.js";
import { systemClock, defaultPolicy, type Clock, type CapabilityProbePort, type PolicyPort } from "./ports.js";
import type { CatalogService } from "./catalog/service.js";
import type { ProviderService } from "./provider/service.js";
import type { Orchestrator } from "./orchestrator/orchestrator.js";
import type { EditorService } from "./editor/editor-service.js";
import type { AutocompleteService } from "./editor/autocomplete.js";
import type { GitService } from "./git/git-service.js";
import type { LoggingService } from "./logging/logging-service.js";
import type { EvidenceService } from "./evidence/evidence-service.js";
import type { UpdateService, MigrationService, PluginService, AboutService } from "./system/system-service.js";
import { PROTOCOL_VERSION } from "@law/contracts";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export interface DaemonOptions {
  probe: CapabilityProbePort;
  catalog: CatalogService;
  providers: ProviderService;
  auth?: { methods(): Promise<unknown>; start(provider: string, authType: "oauth"|"api_key"): Promise<unknown>; get(flowId: string): unknown; respond(flowId: string, response: string): boolean; cancel(flowId: string): boolean; logout(provider: string): Promise<boolean> };
  geminiCliStatus?: () => Promise<{ installed: boolean; configured: boolean; version?: string; authType?: string }>;
  orchestrator: Orchestrator;
  editor: EditorService;
  autocomplete: AutocompleteService;
  git: GitService;
  logging: LoggingService;
  evidence: EvidenceService;
  update: UpdateService;
  migration: MigrationService;
  plugins: PluginService;
  about: AboutService;
  pluginManifests?: PluginManifest[];
  policy?: PolicyPort;
  clock?: Clock;
  socketPath?: string;
  token?: string;
}

export class Daemon {
  readonly token: string;
  readonly socketPath: string;
  private readonly dispatcher: Dispatcher;
  private server: LawdSocketServer | undefined;
  private readonly probe: CapabilityProbePort;
  private readonly catalog: CatalogService;
  private readonly providers: ProviderService;
  private readonly auth: NonNullable<DaemonOptions["auth"]>;
  private readonly geminiCliStatus: NonNullable<DaemonOptions["geminiCliStatus"]>;
  private readonly orchestrator: Orchestrator;
  private readonly editor: EditorService;
  private readonly autocomplete: AutocompleteService;
  private readonly git: GitService;
  private readonly logging: LoggingService;
  private readonly evidence: EvidenceService;
  private readonly update: UpdateService;
  private readonly migration: MigrationService;
  private readonly plugins: PluginService;
  private readonly about: AboutService;
  private readonly pluginManifests: PluginManifest[];
  private readonly policy: PolicyPort;
  private readonly clock: Clock;
  private workspaceRoot: string | undefined;

  constructor(opts: DaemonOptions) {
    this.probe = opts.probe;
    this.catalog = opts.catalog;
    this.providers = opts.providers;
    this.auth = opts.auth ?? { methods: async () => [], start: async () => { throw new Error("Pi authentication unavailable"); }, get: () => { throw new Error("Pi authentication unavailable"); }, respond: () => false, cancel: () => false, logout: async () => false };
    this.geminiCliStatus = opts.geminiCliStatus ?? (async () => ({ installed: false, configured: false }));
    this.orchestrator = opts.orchestrator;
    this.editor = opts.editor;
    this.autocomplete = opts.autocomplete;
    this.git = opts.git;
    this.logging = opts.logging;
    this.evidence = opts.evidence;
    this.update = opts.update;
    this.migration = opts.migration;
    this.plugins = opts.plugins;
    this.about = opts.about;
    this.pluginManifests = opts.pluginManifests ?? [];
    this.policy = opts.policy ?? defaultPolicy;
    this.clock = opts.clock ?? systemClock;
    this.token = opts.token ?? newToken();
    this.socketPath = opts.socketPath ?? defaultSocketPath();

    const registry = createContractRegistry();
    this.dispatcher = new Dispatcher(registry, this.token);
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.dispatcher.handle(daemon_get_health.name, () =>
      buildHealth({ offlineLocalOnly: this.policy.offlineLocalOnly(), now: () => this.clock.now() }),
    );
    this.dispatcher.handle(daemon_probe_capabilities.name, async (payload) => {
      const { refresh } = payload as { refresh: boolean };
      return this.probe.probe(refresh);
    });
    this.dispatcher.handle(model_list_catalog.name, async (payload) => {
      const { query } = payload as { query: string };
      return this.catalog.listCatalog(query);
    });
    this.dispatcher.handle(model_set_favorite.name, (payload) => {
      const { modelId, favorite } = payload as { modelId: string; favorite: boolean };
      return this.catalog.setFavorite(modelId, favorite);
    });
    this.dispatcher.handle(model_resolve_effort.name, async (payload) => {
      const { modelId, effort } = payload as { modelId: string; effort: EffortLevel };
      return this.catalog.resolveEffort(modelId, effort);
    });

    this.dispatcher.handle(provider_list_connections.name, () => this.providers.listConnections());
    this.dispatcher.handle(provider_add_connection.name, (payload) =>
      this.providers.addConnection(payload as AddConnectionInput),
    );
    this.dispatcher.handle(provider_remove_connection.name, (payload) => {
      const { connectionId } = payload as { connectionId: string };
      return this.providers.removeConnection(connectionId);
    });
    this.dispatcher.handle(provider_set_enabled.name, (payload) => {
      const { connectionId, enabled } = payload as { connectionId: string; enabled: boolean };
      return this.providers.setEnabled(connectionId, enabled);
    });
    this.dispatcher.handle(provider_check_credential.name, async (payload) => {
      const { connectionId } = payload as { connectionId: string };
      return this.providers.checkCredential(connectionId);
    });
    this.dispatcher.handle(provider_auth_methods.name, async () => ({ providers: await this.auth.methods() }));
    this.dispatcher.handle(provider_auth_start.name, async (payload) => { const { provider, authType } = payload as { provider: string; authType: "oauth"|"api_key" }; return { flow: await this.auth.start(provider, authType) }; });
    this.dispatcher.handle(provider_auth_get.name, (payload) => ({ flow: this.auth.get((payload as { flowId: string }).flowId) }));
    this.dispatcher.handle(provider_auth_respond.name, (payload) => { const p = payload as { flowId: string; response: string }; return { accepted: this.auth.respond(p.flowId, p.response) }; });
    this.dispatcher.handle(provider_auth_cancel.name, (payload) => ({ cancelled: this.auth.cancel((payload as { flowId: string }).flowId) }));
    this.dispatcher.handle(provider_auth_logout.name, async (payload) => ({ loggedOut: await this.auth.logout((payload as { provider: string }).provider) }));
    this.dispatcher.handle(provider_gemini_cli_status.name, () => this.geminiCliStatus());
    this.dispatcher.handle(net_check_endpoint.name, (payload) => {
      const { target } = payload as { target: string };
      return this.providers.checkEndpoint(target);
    });

    this.dispatcher.handle(task_create.name, (payload) =>
      this.orchestrator.createTask(payload as { title: string; workspaceId?: string; defaultIdentity?: PhaseIdentity }),
    );
    this.dispatcher.handle(task_list.name, (payload) => {
      const { query } = payload as { query: string };
      return this.orchestrator.listTasks(query);
    });
    this.dispatcher.handle(task_get.name, (payload) => {
      const { taskId } = payload as { taskId: string };
      return this.orchestrator.getTask(taskId);
    });
    this.dispatcher.handle(task_send_message.name, (payload) =>
      this.orchestrator.sendMessage(payload as { taskId: string; text: string; identity?: PhaseIdentity }),
    );
    this.dispatcher.handle(task_get_events.name, (payload) => {
      const { taskId, sinceSeq } = payload as { taskId: string; sinceSeq: number };
      return this.orchestrator.getEvents(taskId, sinceSeq);
    });
    this.dispatcher.handle(task_cancel.name, async (payload) => {
      const { taskId } = payload as { taskId: string };
      return this.orchestrator.cancel(taskId);
    });
    this.dispatcher.handle(task_delete.name, (payload) => {
      const { taskId } = payload as { taskId: string };
      return this.orchestrator.deleteTask(taskId);
    });

    this.dispatcher.handle(fs_read_file.name, (payload) => {
      const { path } = payload as { path: string };
      return this.editor.readFile(path);
    });
    this.dispatcher.handle(fs_write_file.name, (payload) => {
      const { path, content, author } = payload as { path: string; content: string; author: "human" | "model" | "formatter" };
      return this.editor.writeFile(path, content, author);
    });
    this.dispatcher.handle(verify_run.name, (payload) => {
      const { path } = payload as { path: string };
      return this.editor.verifyRun(path);
    });
    this.dispatcher.handle(verify_get_status.name, (payload) => {
      const { path } = payload as { path: string };
      return this.editor.status(path);
    });

    this.dispatcher.handle(autocomplete_get_config.name, () => ({ config: this.autocomplete.getConfig() }));
    this.dispatcher.handle(autocomplete_set_config.name, (payload) => ({
      config: this.autocomplete.setConfig(payload as AutocompleteConfig),
    }));
    this.dispatcher.handle(autocomplete_complete.name, async (payload) => {
      const { path, prefix, suffix } = payload as { path: string; prefix: string; suffix: string };
      return this.autocomplete.complete({ path, prefix, suffix });
    });

    this.dispatcher.handle(git_status.name, () => this.git.status());
    this.dispatcher.handle(git_stage.name, (payload) => this.git.stage((payload as { paths: string[] }).paths));
    this.dispatcher.handle(git_commit.name, (payload) => this.git.commit((payload as { message: string }).message));
    this.dispatcher.handle(git_create_branch.name, (payload) => this.git.createBranch((payload as { name: string }).name));
    this.dispatcher.handle(git_remote_action.name, (payload) =>
      this.git.remoteAction(payload as { effect: RemoteEffect; remote: string; branch: string; confirmation?: RemoteConfirmation }),
    );

    this.dispatcher.handle(log_get_policy.name, () => ({ policy: this.logging.getPolicy() }));
    this.dispatcher.handle(log_set_policy.name, (payload) =>
      this.logging.setPolicy(payload as { mode: "off" | "user"; fields: string[]; retentionDays: number; destination: "none" | "local-jsonl" }),
    );

    this.dispatcher.handle(evidence_export.name, (payload) => this.evidence.export((payload as { taskId: string }).taskId));

    this.dispatcher.handle(update_check.name, () => this.update.check());
    this.dispatcher.handle(update_stage.name, (payload) => this.update.stage((payload as { version: string }).version));
    this.dispatcher.handle(migration_status.name, () => this.migration.status());
    this.dispatcher.handle(migration_run.name, () => this.migration.run());
    this.dispatcher.handle(plugin_list.name, () => this.plugins.list(this.pluginManifests));
    this.dispatcher.handle(about_get.name, () => this.about.get());
    this.dispatcher.handle(workspace_get_root.name, () => ({ ...(this.workspaceRoot ? { path: this.workspaceRoot } : {}) }));
    this.dispatcher.handle(workspace_set_root.name, (payload) => {
      const requested = (payload as { path: string }).path;
      if (!isAbsolute(requested)) throw Object.assign(new Error("workspace path must be absolute"), { code: "BAD_REQUEST" });
      const path = resolve(requested);
      if (!existsSync(path) || !statSync(path).isDirectory()) throw Object.assign(new Error("workspace directory does not exist"), { code: "NOT_FOUND" });
      this.editor.setWorkspaceRoot(path);
      this.git.setRepository(path);
      this.workspaceRoot = path;
      return { path };
    });
  }

  /** Operations declared in contracts but not yet handled. Drives the census. */
  missingHandlers(): string[] {
    return this.dispatcher.missingHandlers();
  }

  /** Expose the dispatcher for in-process tests without a socket. */
  get dispatchTarget(): Dispatcher {
    return this.dispatcher;
  }

  async start(): Promise<{ socketPath: string; token: string; protocol: number }> {
    this.server = new LawdSocketServer(this.dispatcher, this.socketPath);
    await this.server.listen();
    writeHandshake({
      socketPath: this.socketPath,
      token: this.token,
      pid: process.pid,
      protocol: PROTOCOL_VERSION,
    });
    return { socketPath: this.socketPath, token: this.token, protocol: PROTOCOL_VERSION };
  }

  async stop(): Promise<void> {
    await this.server?.close();
    clearHandshake();
    this.server = undefined;
  }
}
