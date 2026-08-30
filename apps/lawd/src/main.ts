#!/usr/bin/env node
/**
 * lawd entry point. Starts the daemon: opens the Unix-domain socket, writes the
 * authenticated handshake, and serves health + capability-probe operations bound
 * to LAW Core. The Tauri shell reads the handshake and connects. No TCP port is
 * opened and no credential value is ever written to stdout, logs, or handshake.
 */
import { Daemon } from "./daemon.js";
import { LawCoreProbe, findLawRoot } from "./probe/lawcore-probe.js";
import { CatalogService } from "./catalog/service.js";
import { LawCoreModelSource } from "./catalog/lawcore-source.js";
import { FilePreferencesStore } from "./catalog/preferences.js";
import { ProviderService } from "./provider/service.js";
import { FileConnectionStore } from "./provider/connection-store.js";
import { CredentialBroker } from "./security/credential-broker.js";
import { SpawnCommandRunner } from "./security/command-runner.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { FileTaskStore } from "./orchestrator/task-store.js";
import { LawCorePhaseRunner } from "./orchestrator/lawcore-runner.js";
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
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

async function main(): Promise<void> {
  const lawRoot = findLawRoot();
  const dataRoot = process.env.LAW_DATA_DIR ?? lawRoot;
  const catalog = new CatalogService(
    new LawCoreModelSource(lawRoot),
    FilePreferencesStore.forRoot(dataRoot),
  );
  const providers = new ProviderService({
    store: FileConnectionStore.forRoot(dataRoot),
    broker: new CredentialBroker({ runner: new SpawnCommandRunner() }),
    // Local-first default: offline, no remote egress until a visible action grants it.
    netState: () => ({ offlineLocalOnly: defaultPolicy.offlineLocalOnly(), remoteAuthorized: false }),
  });
  const orchestrator = new Orchestrator({
    store: FileTaskStore.forRoot(dataRoot),
    runner: new LawCorePhaseRunner(lawRoot),
    netState: () => ({ offlineLocalOnly: defaultPolicy.offlineLocalOnly(), remoteAuthorized: false }),
    workspaceRootFor: (task) => (task.workspaceId && task.workspaceId.startsWith("/") ? task.workspaceId : lawRoot),
  });
  const editor = new EditorService({ workspaceRoot: lawRoot, fs: nodeFs });
  const autocomplete = new AutocompleteService();
  const git = new GitService(new NodeGit(lawRoot), lawRoot);
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
  const daemon = new Daemon({ probe: new LawCoreProbe(lawRoot), catalog, providers, orchestrator, editor, autocomplete, git, logging, evidence, update, migration, plugins, about });
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

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ event: "lawd_error", message: err instanceof Error ? err.message : String(err) })}\n`);
  process.exit(1);
});
