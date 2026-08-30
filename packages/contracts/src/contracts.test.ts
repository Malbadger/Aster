import { describe, expect, it } from "vitest";
import {
  ContractRegistry,
  PROTOCOL_VERSION,
  RequestEnvelope,
  ResponseEnvelope,
  createContractRegistry,
  daemon_get_health,
  defineOperation,
} from "./index.js";
import { z } from "zod";

describe("IPC contract core", () => {
  it("builds the canonical registry with unique operation names", () => {
    const r = createContractRegistry();
    const names = r.list().map((o) => o.name);
    expect(names).toContain("daemon_get_health");
    expect(names).toContain("daemon_probe_capabilities");
    expect(new Set(names).size).toBe(names.length);
  });

  it("rejects duplicate operation registration", () => {
    const r = new ContractRegistry();
    r.register(daemon_get_health);
    expect(() => r.register(daemon_get_health)).toThrow(/duplicate/);
  });

  it("rejects an operation name that is not domain_action_resource", () => {
    expect(() =>
      defineOperation({
        name: "BadName",
        schemaVersion: 1,
        summary: "x",
        consequential: false,
        request: z.object({}),
        response: z.object({}),
      }),
    ).toThrow();
  });

  it("validates a well-formed request envelope and rejects a wrong protocol", () => {
    const good = {
      protocol: PROTOCOL_VERSION,
      id: "req-1",
      op: "daemon_get_health",
      schemaVersion: 1,
      payload: {},
    };
    expect(RequestEnvelope.safeParse(good).success).toBe(true);
    expect(RequestEnvelope.safeParse({ ...good, protocol: 999 }).success).toBe(false);
  });

  it("enforces per-operation request schema (health takes no fields)", () => {
    expect(daemon_get_health.request.safeParse({}).success).toBe(true);
    expect(daemon_get_health.request.safeParse({ unexpected: 1 }).success).toBe(false);
  });

  it("round-trips a response envelope", () => {
    const res = {
      protocol: PROTOCOL_VERSION,
      id: "req-1",
      op: "daemon_get_health",
      schemaVersion: 1,
      ok: true,
      result: {
        daemonVersion: "0.1.0-desktop.dev",
        protocol: 1,
        dataSchemaVersion: 1,
        uptimeMs: 10,
        offlineLocalOnly: true,
      },
    };
    const parsed = ResponseEnvelope.safeParse(res);
    expect(parsed.success).toBe(true);
    const health = daemon_get_health.response.safeParse((parsed as any).data.result);
    expect(health.success).toBe(true);
  });
});
