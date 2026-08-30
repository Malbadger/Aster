import { describe, expect, it } from "vitest";
import { EvidenceService, type EvidenceSource } from "./evidence-service.js";
import { EvidenceBundle } from "@law/contracts";

const FAKE_SECRET = "sk-abcdef0123456789ABCDEFGHijklmnopqrst";

const source: EvidenceSource = {
  phases: () => [{ phaseId: "p1", provider: "ollama", model: "llama3.1:8b", effort: "medium" }],
  checks: () => [{ path: "a.ts", result: "pass", changeHash: "h1" }],
  changes: () => [{ path: "a.ts", provenance: "mixed" }],
  // A limit note accidentally contains a secret — it must be redacted out.
  limits: () => [`known token leaked in note: ${FAKE_SECRET}`, "Windows/macOS deferred"],
};

describe("EvidenceService (REQ-D-037/040)", () => {
  it("produces a contract-valid, provider-neutral bundle with no secrets", () => {
    const { bundle } = new EvidenceService(source).export("task-1");
    expect(EvidenceBundle.safeParse(bundle).success).toBe(true);
    expect(bundle.secretScan).toBe("clean");
    expect(JSON.stringify(bundle)).not.toContain(FAKE_SECRET);
    expect(bundle.identities[0]!.model).toBe("llama3.1:8b");
    expect(bundle.checks[0]!.result).toBe("pass");
  });
});
