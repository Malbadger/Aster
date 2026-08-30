import { describe, expect, it } from "vitest";
import { ProviderService } from "./service.js";
import { MemoryConnectionStore } from "./connection-store.js";
import { CredentialBroker, type CommandRunner } from "../security/credential-broker.js";

const FAKE_SECRET = "sk-abcdef0123456789ABCDEFGHijklmnopqrst";

function svc(opts?: { env?: Record<string, string | undefined>; runner?: CommandRunner; offline?: boolean }) {
  const store = new MemoryConnectionStore();
  const broker = new CredentialBroker({ env: opts?.env ?? {}, ...(opts?.runner ? { runner: opts.runner } : {}) });
  const service = new ProviderService({
    store,
    broker,
    netState: () => ({ offlineLocalOnly: opts?.offline ?? true, remoteAuthorized: false }),
  });
  return { store, service };
}

describe("ProviderService — connections carry no secrets", () => {
  it("refuses to add a connection whose reference contains a secret", () => {
    const { service } = svc();
    expect(() =>
      service.addConnection({ provider: "acme", label: "Acme", authMethod: "external-command", locality: "remote", reference: `echo ${FAKE_SECRET}` }),
    ).toThrow(/secret/i);
  });

  it("adds an env-var connection storing only the env NAME, no value", () => {
    const { service, store } = svc({ env: { OPENAI_API_KEY: FAKE_SECRET } });
    const { connection } = service.addConnection({ provider: "acme", label: "Acme", authMethod: "env-var", locality: "remote", reference: "OPENAI_API_KEY" });
    expect(connection.referenceHint).toBe("OPENAI_API_KEY");
    expect(connection.status).toBe("unknown");
    // The secret VALUE must never be persisted anywhere in the store.
    expect(JSON.stringify(store.list())).not.toContain(FAKE_SECRET);
  });

  it("requires a reference for reference-based methods", () => {
    const { service } = svc();
    expect(() => service.addConnection({ provider: "a", label: "A", authMethod: "env-var", locality: "remote" })).toThrow(/reference/i);
  });

  it("resolves env-var availability without leaking the value", async () => {
    const { service, store } = svc({ env: { PRESENT_KEY: FAKE_SECRET } });
    const present = service.addConnection({ provider: "a", label: "Present", authMethod: "env-var", locality: "remote", reference: "PRESENT_KEY" });
    const absent = service.addConnection({ provider: "a", label: "Absent", authMethod: "env-var", locality: "remote", reference: "MISSING_KEY" });
    expect((await service.checkCredential(present.connection.connectionId)).status).toBe("available");
    expect((await service.checkCredential(absent.connection.connectionId)).status).toBe("absent");
    expect(JSON.stringify(store.list())).not.toContain(FAKE_SECRET);
  });

  it("resolves external-command availability; the command's secret output never reaches state", async () => {
    const runner: CommandRunner = { async run() { return { code: 0, stdout: `${FAKE_SECRET}\n` }; } };
    const { service, store } = svc({ runner });
    const { connection } = service.addConnection({ provider: "a", label: "Cmd", authMethod: "external-command", locality: "remote", reference: "get-token" });
    const res = await service.checkCredential(connection.connectionId);
    expect(res.status).toBe("available");
    // The status object and the persisted store contain no secret bytes.
    expect(JSON.stringify(res)).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(store.list())).not.toContain(FAKE_SECRET);
  });

  it("treats none-local as available and enables/disables + removes", async () => {
    const { service } = svc();
    const { connection } = service.addConnection({ provider: "ollama", label: "Local", authMethod: "none-local", locality: "local" });
    expect((await service.checkCredential(connection.connectionId)).status).toBe("available");
    expect(service.setEnabled(connection.connectionId, false).connection.enabled).toBe(false);
    expect(service.removeConnection(connection.connectionId).removed).toBe(true);
  });

  it("blocks a non-loopback endpoint in offline mode", () => {
    const { service } = svc({ offline: true });
    expect(service.checkEndpoint("http://127.0.0.1:11434").allowed).toBe(true);
    const remote = service.checkEndpoint("https://api.example.com");
    expect(remote.allowed).toBe(false);
    expect(remote.code).toBe("OFFLINE_NON_LOOPBACK");
  });
});
