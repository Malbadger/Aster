import { afterEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Daemon } from "./daemon.js";
import { callOverSocket } from "./ipc/socket-client.js";
import { CapabilityProbe, daemon_get_health, daemon_probe_capabilities } from "@law/contracts";
import type { CapabilityProbePort, ModelSourcePort } from "./ports.js";
import { CatalogService } from "./catalog/service.js";
import { MemoryPreferencesStore } from "./catalog/preferences.js";
import { ProviderService } from "./provider/service.js";
import { MemoryConnectionStore } from "./provider/connection-store.js";
import { CredentialBroker } from "./security/credential-broker.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { MemoryTaskStore } from "./orchestrator/task-store.js";
import type { PhaseRunner } from "./orchestrator/phase-runner.js";
import { EditorService, type FsPort } from "./editor/editor-service.js";
import { AutocompleteService } from "./editor/autocomplete.js";
import { GitService, type GitPort } from "./git/git-service.js";
import { LoggingService } from "./logging/logging-service.js";
import { EvidenceService } from "./evidence/evidence-service.js";
import { UpdateService, MigrationService, PluginService, AboutService } from "./system/system-service.js";

const fakeProbe: CapabilityProbePort = {
  async probe() {
    return {
      probedAt: new Date().toISOString(),
      capabilities: [
        { id: "law-core", displayName: "Aster Core", state: "ready", optional: false, detail: "ok" },
        { id: "git", displayName: "Git", state: "ready", optional: true, detail: "git version 2.x" },
      ],
    };
  },
};

const fakeSource: ModelSourcePort = {
  async descriptors() {
    return [
      { id: "ollama:llama3", displayName: "llama3", provider: "ollama", locality: "local", availability: "available", effort: { supported: ["low", "medium", "high"] }, capabilities: { tools: false, vision: false } },
    ];
  },
};

function fakeCatalog() {
  return new CatalogService(fakeSource, new MemoryPreferencesStore());
}

function fakeProviders() {
  return new ProviderService({
    store: new MemoryConnectionStore(),
    broker: new CredentialBroker({ env: {} }),
    netState: () => ({ offlineLocalOnly: true, remoteAuthorized: false }),
  });
}

const nullRunner: PhaseRunner = {
  // eslint-disable-next-line require-yield
  async *run() {
    return;
  },
};

function fakeOrchestrator() {
  return new Orchestrator({
    store: new MemoryTaskStore(),
    runner: nullRunner,
    netState: () => ({ offlineLocalOnly: true, remoteAuthorized: false }),
    workspaceRootFor: () => "/work/ws",
  });
}

const memFs: FsPort = (() => {
  const map = new Map<string, string>();
  return { read: (p) => map.get(p) ?? "", write: (p, c) => void map.set(p, c), exists: (p) => map.has(p) };
})();

function fakeEditor() {
  return new EditorService({ workspaceRoot: "/work/ws", fs: memFs });
}

const okGit: GitPort = { async run() { return { code: 0, stdout: "## main\n", stderr: "" }; } };
function fakeGit() { return new GitService(okGit, "/work/ws"); }
function fakeLogging() { return new LoggingService(); }
function fakeEvidence() { return new EvidenceService({ phases: () => [], checks: () => [], changes: () => [], limits: () => [] }); }
function fakeUpdate() { return new UpdateService("0.1.0", { latest: () => null }); }
function fakeMigration() { let v = 1; return new MigrationService({ getVersion: () => v, setVersion: (x) => void (v = x), snapshot: () => v, restore: (s) => void (v = s as number) }, 1, () => {}); }
function fakePlugins() { return new PluginService(1, ["read"]); }
function fakeAbout() { return new AboutService("0.1.0", () => [], () => []); }

let daemon: Daemon | undefined;
afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
});

function tempSocket() {
  return join(tmpdir(), `lawd-test-${randomBytes(6).toString("hex")}.sock`);
}

describe("Daemon over Unix socket", () => {
  it("registers handlers for every contracted operation (census)", () => {
    daemon = new Daemon({ probe: fakeProbe, catalog: fakeCatalog(), providers: fakeProviders(), orchestrator: fakeOrchestrator(), editor: fakeEditor(), autocomplete: new AutocompleteService(), git: fakeGit(), logging: fakeLogging(), evidence: fakeEvidence(), update: fakeUpdate(), migration: fakeMigration(), plugins: fakePlugins(), about: fakeAbout(), socketPath: tempSocket() });
    expect(daemon.missingHandlers()).toEqual([]);
  });

  it("serves health and a valid capability probe", async () => {
    const socketPath = tempSocket();
    daemon = new Daemon({ probe: fakeProbe, catalog: fakeCatalog(), providers: fakeProviders(), orchestrator: fakeOrchestrator(), editor: fakeEditor(), autocomplete: new AutocompleteService(), git: fakeGit(), logging: fakeLogging(), evidence: fakeEvidence(), update: fakeUpdate(), migration: fakeMigration(), plugins: fakePlugins(), about: fakeAbout(), socketPath, token: "tok", clock: { now: () => 1000 } });
    const info = await daemon.start();
    expect(info.socketPath).toBe(socketPath);

    const health = await callOverSocket(socketPath, "tok", {
      protocol: 1,
      id: "h1",
      op: daemon_get_health.name,
      schemaVersion: 1,
      payload: {},
    });
    expect(health.ok).toBe(true);
    expect((health.result as any).offlineLocalOnly).toBe(true);

    const probe = await callOverSocket(socketPath, "tok", {
      protocol: 1,
      id: "p1",
      op: daemon_probe_capabilities.name,
      schemaVersion: 1,
      payload: { refresh: false },
    });
    expect(probe.ok).toBe(true);
    expect(CapabilityProbe.safeParse(probe.result).success).toBe(true);
  });

  it("refuses a caller that cannot present the token", async () => {
    const socketPath = tempSocket();
    daemon = new Daemon({ probe: fakeProbe, catalog: fakeCatalog(), providers: fakeProviders(), orchestrator: fakeOrchestrator(), editor: fakeEditor(), autocomplete: new AutocompleteService(), git: fakeGit(), logging: fakeLogging(), evidence: fakeEvidence(), update: fakeUpdate(), migration: fakeMigration(), plugins: fakePlugins(), about: fakeAbout(), socketPath, token: "right" });
    await daemon.start();
    const res = await callOverSocket(socketPath, "wrong", {
      protocol: 1,
      id: "x",
      op: daemon_get_health.name,
      schemaVersion: 1,
      payload: {},
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("UNAUTHENTICATED");
  });
});
