/**
 * Evidence contracts (BUILD-D-015, REQ-D-037). An evidence bundle is a redacted,
 * provider-neutral record of a task/phase: configuration hashes, model/human/
 * deterministic identities, checks, changes with provenance, and honest limits.
 * Export is secret-scanned and fails closed on any leak (REQ-D-040).
 */
import { z } from "zod";
import { defineOperation } from "./ipc.js";

export const EvidenceBundle = z.object({
  bundleId: z.string(),
  taskId: z.string(),
  generatedAt: z.string(),
  /** Provider/model/effort identities observed across phases (neutral). */
  identities: z.array(z.object({ phaseId: z.string(), provider: z.string(), model: z.string(), effort: z.string() })),
  /** Verification checks by file with result and content hash. */
  checks: z.array(z.object({ path: z.string(), result: z.string(), changeHash: z.string() })),
  /** Changed files with provenance. */
  changes: z.array(z.object({ path: z.string(), provenance: z.string() })),
  /** Honest limitations recorded for the audit (AS-D-###, human-only gates, etc.). */
  limits: z.array(z.string()),
  /** Always "clean" — export is refused if a secret is detected. */
  secretScan: z.literal("clean"),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundle>;

export const evidence_export = defineOperation({
  name: "evidence_export",
  schemaVersion: 1,
  summary: "Export a redacted, provider-neutral evidence bundle for a task.",
  consequential: true,
  request: z.object({ taskId: z.string().min(1) }),
  response: z.object({ bundle: EvidenceBundle }),
});
