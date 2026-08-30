import { describe, expect, it } from "vitest";
import { checkEndpoint, isLoopbackHost } from "./net-policy.js";

describe("network locality policy (RULE-D-006)", () => {
  it("recognizes loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.5")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
  });

  it("permits loopback inference in local-only mode", () => {
    const d = checkEndpoint("http://127.0.0.1:11434/api/tags", { offlineLocalOnly: true, remoteAuthorized: false });
    expect(d.allowed).toBe(true);
    expect(d.code).toBe("LOOPBACK_OK");
  });

  it("blocks a non-loopback endpoint in local-only mode (not queued)", () => {
    const d = checkEndpoint("https://api.example.com/v1", { offlineLocalOnly: true, remoteAuthorized: false });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("OFFLINE_NON_LOOPBACK");
  });

  it("requires explicit authorization for remote egress when not offline", () => {
    const blocked = checkEndpoint("https://api.example.com", { offlineLocalOnly: false, remoteAuthorized: false });
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe("REMOTE_NEEDS_AUTH");
    const ok = checkEndpoint("https://api.example.com", { offlineLocalOnly: false, remoteAuthorized: true });
    expect(ok.allowed).toBe(true);
    expect(ok.code).toBe("REMOTE_OK");
  });
});
