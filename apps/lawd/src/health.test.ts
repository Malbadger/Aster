import { describe, expect, it } from "vitest";
import { buildHealth } from "./health.js";
import { DaemonHealth, PROTOCOL_VERSION } from "@law/contracts";

describe("lawd health", () => {
  it("produces a contract-valid health snapshot", () => {
    const h = buildHealth({ offlineLocalOnly: true, now: () => Date.now() + 1000 });
    expect(DaemonHealth.safeParse(h).success).toBe(true);
    expect(h.protocol).toBe(PROTOCOL_VERSION);
    expect(h.offlineLocalOnly).toBe(true);
    expect(h.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it("reports non-offline when egress is permitted", () => {
    const h = buildHealth({ offlineLocalOnly: false });
    expect(h.offlineLocalOnly).toBe(false);
  });
});
