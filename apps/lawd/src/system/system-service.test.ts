import { describe, expect, it, vi } from "vitest";
import { AboutService, MigrationService, PluginService, UpdateService, type MigrationStore, type ReleaseProvider } from "./system-service.js";
import type { UpdateInfo } from "@law/contracts";

const signed: UpdateInfo = { version: "0.2.0", source: "github", sha256: "abc", signaturePresent: true, compatible: true };

describe("UpdateService (REQ-D-041, OPEN-D-003)", () => {
  it("reports offline recovery when release metadata is unreachable", () => {
    const svc = new UpdateService("0.1.0", { latest: () => { throw new Error("net"); } });
    expect(svc.check().reason).toMatch(/offline/);
  });

  it("stages a compatible release without replacing the running one", () => {
    const marker = vi.fn();
    const svc = new UpdateService("0.1.0", { latest: () => signed }, marker);
    const r = svc.stage("0.2.0");
    expect(r.staged).toBe(true);
    expect(marker).toHaveBeenCalledWith("0.2.0");
  });

  it("refuses to stage an incompatible release", () => {
    const provider: ReleaseProvider = { latest: () => ({ ...signed, compatible: false }) };
    expect(new UpdateService("0.1.0", provider).stage("0.2.0").staged).toBe(false);
  });

  it("stages an unsigned release only with a manual-verification note (no auto-apply)", () => {
    const provider: ReleaseProvider = { latest: () => ({ ...signed, signaturePresent: false }) };
    const r = new UpdateService("0.1.0", provider).stage("0.2.0");
    expect(r.staged).toBe(true);
    expect(r.reason).toMatch(/manual verification/);
  });
});

describe("MigrationService (REQ-D-042)", () => {
  function store(initial: number): MigrationStore & { data: number[] } {
    const s = { version: initial, data: [] as number[], snap: null as unknown };
    return {
      data: s.data,
      getVersion: () => s.version,
      setVersion: (v) => void (s.version = v),
      snapshot: () => [...s.data],
      restore: (snap) => void (s.data.length = 0, (snap as number[]).forEach((x) => s.data.push(x))),
    };
  }

  it("migrates forward transactionally", () => {
    const st = store(0);
    const svc = new MigrationService(st, 2, (v) => st.data.push(v));
    const r = svc.run();
    expect(r.ok).toBe(true);
    expect(r.to).toBe(2);
    expect(st.getVersion()).toBe(2);
  });

  it("rolls back completely when a step fails", () => {
    const st = store(0);
    const svc = new MigrationService(st, 3, (v) => { st.data.push(v); if (v === 1) throw new Error("bad step"); });
    const r = svc.run();
    expect(r.ok).toBe(false);
    expect(r.rolledBack).toBe(true);
    expect(st.getVersion()).toBe(0);
    expect(st.data).toEqual([]); // snapshot restored
  });
});

describe("PluginService (REQ-D-043)", () => {
  const svc = new PluginService(1, ["read", "write"]);
  it("enables a compatible least-privilege plugin", () => {
    const { plugins } = svc.list([{ id: "p", version: "1", apiVersion: 1, permissions: ["read"] }]);
    expect(plugins[0]!.compatible).toBe(true);
    expect(plugins[0]!.enabled).toBe(true);
  });
  it("disables an incompatible API version with a reason", () => {
    const { plugins } = svc.list([{ id: "p", version: "1", apiVersion: 2, permissions: [] }]);
    expect(plugins[0]!.enabled).toBe(false);
    expect(plugins[0]!.reason).toMatch(/API/);
  });
  it("disables a plugin requesting permissions outside least privilege", () => {
    const { plugins } = svc.list([{ id: "p", version: "1", apiVersion: 1, permissions: ["read", "network"] }]);
    expect(plugins[0]!.enabled).toBe(false);
    expect(plugins[0]!.reason).toMatch(/least-privilege/);
  });
});

describe("AboutService (REQ-D-045)", () => {
  it("reports honest limitations and human-only gates", () => {
    const svc = new AboutService("0.1.0-desktop.dev", () => ["Windows/macOS deferred"], () => ["release signing"]);
    const a = svc.get();
    expect(a.name).toBe("LAW");
    expect(a.limitations).toContain("Windows/macOS deferred");
    expect(a.humanOnlyGates).toContain("release signing");
  });
});
