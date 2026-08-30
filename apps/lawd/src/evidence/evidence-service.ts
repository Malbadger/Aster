/**
 * Evidence service (BUILD-D-015, REQ-D-037/040). Assembles a redacted,
 * provider-neutral evidence bundle for a task and secret-scans it. Export fails
 * closed: if any secret survives redaction the export is refused rather than
 * leaking. Distinguishes model / human / deterministic identities and records
 * honest limits.
 */
import { randomUUID } from "node:crypto";
import type { EvidenceBundle } from "@law/contracts";
import { Redactor } from "../security/redaction.js";

export interface EvidenceSource {
  phases(taskId: string): { phaseId: string; provider: string; model: string; effort: string }[];
  checks(taskId: string): { path: string; result: string; changeHash: string }[];
  changes(taskId: string): { path: string; provenance: string }[];
  limits(): string[];
}

export class EvidenceService {
  private readonly redactor: Redactor;
  constructor(
    private readonly source: EvidenceSource,
    deps: { redactor?: Redactor; now?: () => Date } = {},
  ) {
    this.redactor = deps.redactor ?? new Redactor();
    this.now = deps.now ?? (() => new Date());
  }
  private readonly now: () => Date;

  export(taskId: string): { bundle: EvidenceBundle } {
    const raw = {
      bundleId: `ev-${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      taskId,
      generatedAt: this.now().toISOString(),
      identities: this.source.phases(taskId),
      checks: this.source.checks(taskId),
      changes: this.source.changes(taskId),
      limits: this.source.limits(),
    };
    // Redact, then fail closed if any secret survived.
    const redacted = this.redactor.redact(raw);
    if (!this.redactor.isClean(redacted)) {
      throw Object.assign(new Error("evidence export refused: secret material detected after redaction"), { code: "SECRET_DETECTED" });
    }
    const bundle: EvidenceBundle = { ...redacted, secretScan: "clean" };
    return { bundle };
  }
}
