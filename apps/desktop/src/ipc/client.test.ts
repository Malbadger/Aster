import { describe, expect, it } from "vitest";
import { createIpcClient, IpcClientError } from "./client.js";
import { PROTOCOL_VERSION, daemon_get_health } from "@law/contracts";
import type { IpcTransport } from "./client.js";

function fakeTransport(handler: (req: any) => unknown): IpcTransport {
  return { async send(req) { return handler(req); } };
}

describe("IPC client", () => {
  it("validates request and returns a schema-checked result", async () => {
    const transport = fakeTransport((req) => ({
      protocol: PROTOCOL_VERSION,
      id: req.id,
      op: req.op,
      schemaVersion: req.schemaVersion,
      ok: true,
      result: {
        daemonVersion: "0.1.0-desktop.dev",
        protocol: 1,
        dataSchemaVersion: 1,
        uptimeMs: 5,
        offlineLocalOnly: true,
      },
    }));
    const client = createIpcClient(transport);
    const health = await client.call(daemon_get_health, {});
    expect(health.offlineLocalOnly).toBe(true);
  });

  it("throws a typed error when the daemon returns an error envelope", async () => {
    const transport = fakeTransport((req) => ({
      protocol: PROTOCOL_VERSION,
      id: req.id,
      op: req.op,
      schemaVersion: req.schemaVersion,
      ok: false,
      error: { code: "POLICY_DENIED", message: "blocked", recovery: "adjust policy" },
    }));
    const client = createIpcClient(transport);
    await expect(client.call(daemon_get_health, {})).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
  });

  it("fails closed when the result violates the response schema", async () => {
    const transport = fakeTransport((req) => ({
      protocol: PROTOCOL_VERSION,
      id: req.id,
      op: req.op,
      schemaVersion: req.schemaVersion,
      ok: true,
      result: { daemonVersion: 123 }, // wrong type
    }));
    const client = createIpcClient(transport);
    await expect(client.call(daemon_get_health, {})).rejects.toBeInstanceOf(IpcClientError);
  });
});
