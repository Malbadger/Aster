import { describe, expect, it } from "vitest";
import { PolicyGate } from "./gate.js";

const gate = new PolicyGate({
  allowedTools: ["read_file", "write_file"],
  workspaceRoot: "/work/ws",
  netState: () => ({ offlineLocalOnly: true, remoteAuthorized: false }),
});

describe("PolicyGate (REQ-D-024)", () => {
  it("denies a tool not on the allowlist", () => {
    expect(gate.decide({ tool: "exec_shell", input: {} }).allow).toBe(false);
  });

  it("allows an allowlisted tool with a contained path", () => {
    expect(gate.decide({ tool: "read_file", input: { path: "/work/ws/src/a.ts" } }).allow).toBe(true);
    expect(gate.decide({ tool: "read_file", input: { path: "notes.md" } }).allow).toBe(true);
  });

  it("blocks a path that escapes the workspace before any effect", () => {
    const d = gate.decide({ tool: "write_file", input: { path: "/etc/passwd" } });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/escapes the workspace/);
  });

  it("blocks a non-loopback url in offline mode", () => {
    const d = gate.decide({ tool: "read_file", input: { url: "https://evil.example.com" } });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/blocked, not queued|not loopback/);
  });

  it("allows a loopback url", () => {
    expect(gate.decide({ tool: "read_file", input: { endpoint: "http://127.0.0.1:11434" } }).allow).toBe(true);
  });
});
