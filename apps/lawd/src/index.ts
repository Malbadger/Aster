/**
 * @law/lawd — the LAW local daemon.
 *
 * The daemon is the sole authority for providers, tools, shell, Git, files,
 * policy, evidence, and credentials. The Tauri shell and React UI reach it only
 * through the typed IPC contracts in @law/contracts over the authenticated
 * local socket. It binds to the existing LAW Core (src/ -> dist/) rather than
 * duplicating it.
 */
export { buildHealth } from "./health.js";
export type { HealthInputs } from "./health.js";
export { Daemon } from "./daemon.js";
export type { DaemonOptions } from "./daemon.js";
export { Dispatcher, LawdSocketServer } from "./ipc/server.js";
export type { Handler, HandlerContext, RequestFrame } from "./ipc/server.js";
export { callOverSocket } from "./ipc/socket-client.js";
export {
  readHandshake,
  writeHandshake,
  clearHandshake,
  handshakePath,
  defaultSocketPath,
  newToken,
} from "./ipc/handshake.js";
export type { Handshake } from "./ipc/handshake.js";
export { LawCoreProbe, findLawRoot } from "./probe/lawcore-probe.js";
export { detectGit } from "./probe/git.js";
export { CatalogService } from "./catalog/service.js";
export { LawCoreModelSource } from "./catalog/lawcore-source.js";
export { FilePreferencesStore, MemoryPreferencesStore } from "./catalog/preferences.js";
export { ProviderService } from "./provider/service.js";
export type { ProviderServiceDeps } from "./provider/service.js";
export { FileConnectionStore, MemoryConnectionStore } from "./provider/connection-store.js";
export type { ConnectionStore } from "./provider/connection-store.js";
export { Redactor, BUILTIN_SECRET_PATTERNS } from "./security/redaction.js";
export type { SecretPattern, Finding } from "./security/redaction.js";
export { CredentialBroker } from "./security/credential-broker.js";
export type { CommandRunner, BrokerProbe } from "./security/credential-broker.js";
export { SpawnCommandRunner } from "./security/command-runner.js";
export { checkEndpoint, isLoopbackHost } from "./security/net-policy.js";
export type { NetPolicyState } from "./security/net-policy.js";
export { PolicyGate } from "./policy/gate.js";
export type { GateConfig } from "./policy/gate.js";
export { Orchestrator } from "./orchestrator/orchestrator.js";
export type { OrchestratorDeps } from "./orchestrator/orchestrator.js";
export { MemoryTaskStore, FileTaskStore } from "./orchestrator/task-store.js";
export type { TaskStore } from "./orchestrator/task-store.js";
export { interpret } from "./orchestrator/interpret.js";
export { LawCorePhaseRunner } from "./orchestrator/lawcore-runner.js";
export type { PhaseRunner, PhaseEvent, PhaseRunRequest, ToolGate, ToolDecision } from "./orchestrator/phase-runner.js";
export { EditorService, hashContent } from "./editor/editor-service.js";
export type { EditorDeps, FsPort, Checker } from "./editor/editor-service.js";
export { nodeFs } from "./editor/node-fs.js";
export { buildHunks, applyHunks, toContractHunk } from "./editor/diff.js";
export type { InternalHunk } from "./editor/diff.js";
export { AutocompleteService } from "./editor/autocomplete.js";
export type { Completer, CompleteRequest, AutocompleteResult } from "./editor/autocomplete.js";
export { GitService, parseStatus } from "./git/git-service.js";
export type { GitPort, GitRunResult } from "./git/git-service.js";
export { NodeGit } from "./git/node-git.js";
export { LoggingService } from "./logging/logging-service.js";
export type { LogSink, LoggingDeps } from "./logging/logging-service.js";
export { EvidenceService } from "./evidence/evidence-service.js";
export type { EvidenceSource } from "./evidence/evidence-service.js";
export { UpdateService, MigrationService, PluginService, AboutService } from "./system/system-service.js";
export type { ReleaseProvider, MigrationStore } from "./system/system-service.js";
export type {
  Clock,
  CapabilityProbePort,
  PolicyPort,
  ModelSourcePort,
  PreferencesStore,
} from "./ports.js";
export { systemClock, defaultPolicy } from "./ports.js";
