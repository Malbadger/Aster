import { describe, expect, it } from "vitest";
import { Dispatcher } from "./server.js";
import { createContractRegistry, PROTOCOL_VERSION, daemon_get_health } from "@law/contracts";

function makeDispatcher(token = "secret") {
  const d = new Dispatcher(createContractRegistry(), token);
  d.handle(daemon_get_health.name, () => ({
    daemonVersion: "0.1.0-desktop.dev",
    protocol: PROTOCOL_VERSION,
    dataSchemaVersion: 1,
    uptimeMs: 1,
    offlineLocalOnly: true,
  }));
  return d;
}

function req(op: string, payload: unknown, schemaVersion = 1) {
  return { protocol: PROTOCOL_VERSION, id: "r1", op, schemaVersion, payload };
}

describe("Dispatcher", () => {
  it("rejects a missing or wrong token before anything else", async () => {
    const d = makeDispatcher("secret");
    const res = await d.dispatch({ token: "wrong", request: req("daemon_get_health", {}) });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("UNAUTHENTICATED");
  });

  it("handles a valid health request", async () => {
    const d = makeDispatcher();
    const res = await d.dispatch({ token: "secret", request: req("daemon_get_health", {}) });
    expect(res.ok).toBe(true);
    expect((res.result as any).offlineLocalOnly).toBe(true);
  });

  it("rejects an unknown operation", async () => {
    const d = makeDispatcher();
    const res = await d.dispatch({ token: "secret", request: req("daemon_get_nothing", {}) });
    expect(res.error?.code).toBe("UNKNOWN_OPERATION");
  });

  it("rejects a schema-version mismatch", async () => {
    const d = makeDispatcher();
    const res = await d.dispatch({ token: "secret", request: req("daemon_get_health", {}, 999) });
    expect(res.error?.code).toBe("SCHEMA_MISMATCH");
  });

  it("rejects a malformed envelope", async () => {
    const d = makeDispatcher();
    const res = await d.dispatch({ token: "secret", request: { not: "an envelope" } });
    expect(res.error?.code).toBe("BAD_REQUEST");
  });

  it("reports UNAVAILABLE for a contracted operation with no handler", async () => {
    const d = new Dispatcher(createContractRegistry(), "secret"); // no handlers registered
    const res = await d.dispatch({ token: "secret", request: req("daemon_get_health", {}) });
    expect(res.error?.code).toBe("UNAVAILABLE");
    expect(d.missingHandlers()).toContain("daemon_get_health");
  });

  it("fails closed when a handler returns an invalid result", async () => {
    const d = new Dispatcher(createContractRegistry(), "secret");
    d.handle(daemon_get_health.name, () => ({ daemonVersion: 123 }));
    const res = await d.dispatch({ token: "secret", request: req("daemon_get_health", {}) });
    expect(res.error?.code).toBe("INTERNAL");
  });
});
