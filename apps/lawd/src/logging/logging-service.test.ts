import { describe, expect, it } from "vitest";
import { LoggingService } from "./logging-service.js";
import type { LogPolicy } from "@law/contracts";

const FAKE_SECRET = "sk-abcdef0123456789ABCDEFGHijklmnopqrst";

describe("LoggingService (REQ-D-038..040)", () => {
  it("is off by default and writes nothing", () => {
    const lines: string[] = [];
    const svc = new LoggingService({ sink: { write: (l) => lines.push(l) } });
    expect(svc.getPolicy().mode).toBe("off");
    expect(svc.append({ event: "x" })).toBe(false);
    expect(lines).toHaveLength(0);
  });

  it("lets an unmanaged user enable local JSONL logging", () => {
    const lines: string[] = [];
    const svc = new LoggingService({ sink: { write: (l) => lines.push(l) } });
    const res = svc.setPolicy({ mode: "user", fields: ["event"], retentionDays: 7, destination: "local-jsonl" });
    expect(res.refused).toBe(false);
    expect(svc.append({ event: "task_started" })).toBe(true);
    expect(lines[0]).toContain("task_started");
  });

  it("never writes a credential, even when logging is enabled", () => {
    const lines: string[] = [];
    const svc = new LoggingService({ sink: { write: (l) => lines.push(l) } });
    svc.setPolicy({ mode: "user", fields: [], retentionDays: 7, destination: "local-jsonl" });
    svc.append({ event: "auth", token: FAKE_SECRET, note: `bearer ${FAKE_SECRET}` });
    expect(lines.join("")).not.toContain(FAKE_SECRET);
  });

  it("refuses user override when a managed policy is in force (RULE-D-005)", () => {
    const managed: LogPolicy = { mode: "managed", managed: true, fields: ["event"], retentionDays: 90, destination: "local-jsonl" };
    const svc = new LoggingService({ managedPolicy: managed });
    expect(svc.getPolicy().managed).toBe(true);
    const res = svc.setPolicy({ mode: "off", fields: [], retentionDays: 1, destination: "none" });
    expect(res.refused).toBe(true);
    expect(svc.getPolicy().mode).toBe("managed");
  });
});
