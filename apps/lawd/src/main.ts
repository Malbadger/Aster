#!/usr/bin/env node
/**
 * lawd entry point. Starts the daemon: opens the Unix-domain socket, writes the
 * authenticated handshake, and serves health + capability-probe operations bound
 * to Aster Core. The Tauri shell reads the handshake and connects. No TCP port is
 * opened and no credential value is ever written to stdout, logs, or handshake.
 */
import { Daemon } from "./daemon.js";
import { LawCoreProbe, findLawRoot } from "./probe/lawcore-probe.js";
import { CatalogService } from "./catalog/service.js";
import { LawCoreModelSource } from "./catalog/lawcore-source.js";
import { FilePreferencesStore } from "./catalog/preferences.js";
import { ProviderService } from "./provider/service.js";
import { FileConnectionStore } from "./provider/connection-store.js";
import { customProviderSpecs } from "./provider/custom-spec.js";
import { GeminiCliService } from "./provider/gemini-cli.js";
import { CredentialBroker } from "./security/credential-broker.js";
import { SpawnCommandRunner } from "./security/command-runner.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { FileTaskStore } from "./orchestrator/task-store.js";
import { LawCorePhaseRunner } from "./orchestrator/lawcore-runner.js";
import { AntigravityPhaseRunner, GeminiCliPhaseRunner, ProviderPhaseRunner } from "./orchestrator/gemini-cli-runner.js";
import { ClaudeCodePhaseRunner } from "./orchestrator/claude-code-runner.js";
import { EditorService } from "./editor/editor-service.js";
import { nodeFs } from "./editor/node-fs.js";
import { AutocompleteService } from "./editor/autocomplete.js";
import { GitService } from "./git/git-service.js";
import { NodeGit } from "./git/node-git.js";
import { LoggingService } from "./logging/logging-service.js";
import { EvidenceService } from "./evidence/evidence-service.js";
import { UpdateService, MigrationService, PluginService, AboutService } from "./system/system-service.js";
import { DESKTOP_VERSION, DATA_SCHEMA_VERSION } from "@law/contracts";
import { defaultPolicy } from "./ports.js";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { AttachmentService } from "./attachment/attachment-service.js";
import { McpRegistryService } from "./mcp/mcp-registry-service.js";

async function main(): Promise<void> {
  const lawRoot = findLawRoot();
  const defaultWorkspace = homedir();
  const dataRoot = process.env.LAW_DATA_DIR ?? lawRoot;
  const connectionStore = FileConnectionStore.forRoot(dataRoot);
  const customProviders = () => customProviderSpecs(connectionStore.list());
  const geminiCli = new GeminiCliService(lawRoot);
  const catalog = new CatalogService(
    new LawCoreModelSource(lawRoot, customProviders, () => geminiCli.status()),
    FilePreferencesStore.forRoot(dataRoot),
  );
  const authModule = await import(pathToFileURL(join(lawRoot, "dist", "pi-adapter", "index.js")).href) as { PiAuthBroker: new (custom?: () => unknown[]) => any };
  const auth = new authModule.PiAuthBroker(customProviders);
  const mcp = McpRegistryService.forRoot(dataRoot);
  const providers = new ProviderService({
    store: connectionStore,
    broker: new CredentialBroker({ runner: new SpawnCommandRunner() }),
    // Local-first default: offline, no remote egress until a visible action grants it.
    netState: () => ({ offlineLocalOnly: defaultPolicy.offlineLocalOnly(), remoteAuthorized: false }),
    authConfigured: (provider) => auth.configured(provider),
  });
  const piRunner = new LawCorePhaseRunner(lawRoot, (provider) => customProviders().find((item) => item.id === provider));
  const phaseRunner = new ProviderPhaseRunner(
    piRunner,
    new GeminiCliPhaseRunner(geminiCli.cliPath),
    new AntigravityPhaseRunner(geminiCli.antigravityPath),
    new ClaudeCodePhaseRunner(undefined, mcp.claudeConfigPath, () => mcp.environment()),
  );
  const attachments = new AttachmentService(dataRoot);
  const orchestrator = new Orchestrator({
    store: FileTaskStore.forRoot(dataRoot),
    runner: phaseRunner,
    netState: () => ({ offlineLocalOnly: defaultPolicy.offlineLocalOnly(), remoteAuthorized: false }),
    workspaceRootFor: (task) => (task.workspaceId && task.workspaceId.startsWith("/") ? task.workspaceId : defaultWorkspace),
    attachments,
    orchestrationGuide: loadOrchestrationGuide(lawRoot),
  });
  const editor = new EditorService({ workspaceRoot: defaultWorkspace, fs: nodeFs });
  const autocomplete = new AutocompleteService();
  const git = new GitService(new NodeGit(defaultWorkspace), defaultWorkspace);
  const logging = new LoggingService({
    sink: {
      write: (line) => {
        mkdirSync(join(dataRoot, ".law", "logs"), { recursive: true });
        appendFileSync(join(dataRoot, ".law", "logs", "law.jsonl"), `${line}\n`, { mode: 0o600 });
      },
    },
  });
  const evidence = new EvidenceService({
    phases: (taskId) => orchestrator.getTask(taskId).phases.map((ph) => ({ phaseId: ph.phaseId, provider: ph.identity.provider, model: ph.identity.model, effort: ph.identity.effort })),
    checks: () => [],
    changes: () => [],
    limits: () => ["Windows/macOS deferred (OPEN-D-002)", "Packaging and UAT run on Ubuntu 24.04 (AS-D-001)"],
  });
  const update = new UpdateService(DESKTOP_VERSION, { latest: () => null });
  let schemaVersion: number = DATA_SCHEMA_VERSION;
  const migration = new MigrationService(
    { getVersion: () => schemaVersion, setVersion: (v) => void (schemaVersion = v), snapshot: () => schemaVersion, restore: (s) => void (schemaVersion = s as number) },
    DATA_SCHEMA_VERSION,
    () => {},
  );
  const plugins = new PluginService(1, ["read", "write", "diagnostics"]);
  const about = new AboutService(
    DESKTOP_VERSION,
    () => ["Windows/macOS deferred (OPEN-D-002)", "Packaging and UAT run on Ubuntu 24.04 (AS-D-001)", "Local models require a loopback endpoint (e.g. Ollama)"],
    () => ["final visual baseline", "live provider login/paid use", "license/trademark review", "release signing and publication"],
  );
  const daemon = new Daemon({ probe: new LawCoreProbe(lawRoot), catalog, providers, auth, geminiCliStatus: () => geminiCli.status(), orchestrator, editor, autocomplete, git, logging, evidence, update, migration, plugins, about, attachments, mcp, workspaceRoot: defaultWorkspace });
  const info = await daemon.start();

  // Structured, secret-free startup line (token is NEVER logged).
  process.stdout.write(
    `${JSON.stringify({
      event: "lawd_started",
      socketPath: info.socketPath,
      protocol: info.protocol,
      lawRoot,
      pendingOperations: daemon.missingHandlers(),
    })}\n`,
  );

  const shutdown = () => {
    void daemon.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function loadOrchestrationGuide(lawRoot: string): string | undefined {
  const path = join(lawRoot, "skills", "orchestrate-aster-models", "SKILL.md");
  if (!existsSync(path)) return undefined;
  const contents = readFileSync(path, "utf8");
  return contents.replace(/^---[\s\S]*?---\s*/, "").trim();
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ event: "lawd_error", message: err instanceof Error ? err.message : String(err) })}\n`);
  process.exit(1);
});
